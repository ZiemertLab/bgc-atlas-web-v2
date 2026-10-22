import { spawn } from 'child_process';

import { remoteCommand, replacingDockerRun } from './shell-quote';

// SEQSEARCH_EXEC_MODE 'local' (default) runs in a conda env; 'ssh-docker' runs in a container on a
// remote host mounting the same CephFS at the same path, so the session dir must be on CephFS.

// Keepalives so long silent runs don't get the SSH connection idled out (exit code 255).
const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=240',
];

export interface SeqSearchCommand {
  command: string;
  args: string[];
  mode: 'local' | 'ssh-docker';
}

function dockerUser(): string {
  return process.env.SEQSEARCH_DOCKER_USER
    || (typeof process.getuid === 'function' && typeof process.getgid === 'function'
      ? `${process.getuid()}:${process.getgid()}`
      : '');
}

export function buildSeqSearchCommand(
  condaEnv: string,
  dockerImage: string,
  toolArgs: string[],
  containerName?: string,
): SeqSearchCommand {
  const execMode = process.env.SEQSEARCH_EXEC_MODE || 'local';

  if (execMode === 'ssh-docker') {
    const sshHost = process.env.SEQSEARCH_SSH_HOST || 'docker-host';
    const cephMount = process.env.SEQSEARCH_CEPH_MOUNT || '/data/bgc-atlas';
    const user = dockerUser();
    const runArgs = [
      ...(user ? ['--user', user] : []),
      '-v', `${cephMount}:${cephMount}`,
      dockerImage,
      ...toolArgs,
    ];
    return {
      command: 'ssh',
      // One quoted string: ssh hands everything after the host to a remote shell.
      args: [
        ...SSH_OPTS,
        sshHost,
        containerName
          ? replacingDockerRun(containerName, runArgs)
          : remoteCommand(['docker', 'run', '--rm', ...runArgs]),
      ],
      mode: 'ssh-docker',
    };
  }

  return { command: 'conda', args: ['run', '-n', condaEnv, ...toolArgs], mode: 'local' };
}

function sshExitOk(sshHost: string, remoteArgs: string[], logPrefix?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...SSH_OPTS, sshHost, remoteCommand(remoteArgs)], {
      stdio: ['ignore', logPrefix ? 'pipe' : 'ignore', logPrefix ? 'pipe' : 'ignore'],
    });
    if (logPrefix) {
      child.stdout?.on('data', (d) => console.log(`${logPrefix} ${d.toString().trimEnd()}`));
      child.stderr?.on('data', (d) => console.log(`${logPrefix} ${d.toString().trimEnd()}`));
    }
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export type RemoteImageState = 'present' | 'missing' | 'unchecked';

/**
 * Read `docker image inspect` over ssh. Only docker's own "No such image" is a missing image:
 * an ssh failure (exit 255), a connect timeout or an unreachable daemon also exit non-zero, and
 * counting those as missing set off a rebuild or pull against a host whose image was fine.
 */
export function classifyImageInspect(exitCode: number | null, stderr: string): RemoteImageState {
  if (exitCode === 0) return 'present';
  if (exitCode === 1 && /No such (image|object)/i.test(stderr)) return 'missing';
  return 'unchecked';
}

export function remoteImageState(
  sshHost: string,
  image: string,
  sshOpts: string[] = SSH_OPTS
): Promise<{ state: RemoteImageState; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...sshOpts, sshHost, remoteCommand(['docker', 'image', 'inspect', image])], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const detail = `exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ''}`;
      resolve({ state: classifyImageInspect(code, stderr), detail });
    });
    child.on('error', (error) => resolve({ state: 'unchecked', detail: `ssh spawn failed: ${error.message}` }));
  });
}

// In ssh-docker mode, re-pulls and re-tags from `dockerPull` if the host's image was cleaned;
// a check that could not reach the host or its daemon does not pull.
export async function checkSeqSearchAvailability(
  condaEnv: string,
  toolBin: string,
  dockerImage: string,
  dockerPull?: string
): Promise<boolean> {
  const execMode = process.env.SEQSEARCH_EXEC_MODE || 'local';

  if (execMode === 'ssh-docker') {
    const sshHost = process.env.SEQSEARCH_SSH_HOST || 'docker-host';
    const { state, detail } = await remoteImageState(sshHost, dockerImage);
    if (state === 'present') return true;
    if (state === 'unchecked') {
      console.error(`Could not check image ${dockerImage} on ${sshHost} (${detail}); not pulling`);
      return false;
    }
    if (!dockerPull) return false;
    console.warn(`Image ${dockerImage} not found on ${sshHost}; pulling ${dockerPull}`);
    const pulled = await sshExitOk(sshHost, ['docker', 'pull', dockerPull], '[seqsearch pull]');
    if (!pulled) return false;
    await sshExitOk(sshHost, ['docker', 'tag', dockerPull, dockerImage]);
    return sshExitOk(sshHost, ['docker', 'image', 'inspect', dockerImage]);
  }

  return new Promise((resolve) => {
    const child = spawn('conda', ['run', '-n', condaEnv, 'which', toolBin], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export function seqSearchThreads(): number {
  return Number(process.env.SEQSEARCH_THREADS) || 16;
}
