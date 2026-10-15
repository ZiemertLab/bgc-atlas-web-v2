import { spawn } from 'child_process';

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
  toolArgs: string[]
): SeqSearchCommand {
  const execMode = process.env.SEQSEARCH_EXEC_MODE || 'local';

  if (execMode === 'ssh-docker') {
    const sshHost = process.env.SEQSEARCH_SSH_HOST || 'docker-host';
    const cephMount = process.env.SEQSEARCH_CEPH_MOUNT || '/data/bgc-atlas';
    const user = dockerUser();
    return {
      command: 'ssh',
      args: [
        ...SSH_OPTS,
        sshHost,
        'docker', 'run', '--rm',
        ...(user ? ['--user', user] : []),
        '-v', `${cephMount}:${cephMount}`,
        dockerImage,
        ...toolArgs,
      ],
      mode: 'ssh-docker',
    };
  }

  return { command: 'conda', args: ['run', '-n', condaEnv, ...toolArgs], mode: 'local' };
}

function sshExitOk(sshHost: string, remoteArgs: string[], logPrefix?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...SSH_OPTS, sshHost, ...remoteArgs], {
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

// In ssh-docker mode, re-pulls and re-tags from `dockerPull` if the host's image was cleaned.
export async function checkSeqSearchAvailability(
  condaEnv: string,
  toolBin: string,
  dockerImage: string,
  dockerPull?: string
): Promise<boolean> {
  const execMode = process.env.SEQSEARCH_EXEC_MODE || 'local';

  if (execMode === 'ssh-docker') {
    const sshHost = process.env.SEQSEARCH_SSH_HOST || 'docker-host';
    if (await sshExitOk(sshHost, ['docker', 'image', 'inspect', dockerImage])) return true;
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
