import { spawn } from 'child_process';

import type { BiGSliceTier } from './families';
import { access, mkdir } from 'fs/promises';
import { createWriteStream } from 'fs';

// Shared SSH options for remote (ssh-docker) execution: never prompt, fail fast on connect, and
// keepalive so long silent remote runs don't get the connection idled out (surfaces as exit 255).
const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=240',
];

// 22% of placed BGCs belong to more than one family, so the nearest hit alone hides near-twins.
const QUERY_RANKS = 3;

/** Where each tier's query workspace lives. Both hold `--run_id 1`. */
const TIER_DIR_ENV: Record<BiGSliceTier, string> = {
  seed: 'BIGSLICE_SEED_DIR',
  fragmented: 'BIGSLICE_RESIDUAL_DIR',
};

export function tierWorkspace(tier: BiGSliceTier): string {
  const fromEnv = process.env[TIER_DIR_ENV[tier]];
  if (fromEnv) {
    return fromEnv;
  }
  throw new Error(`${TIER_DIR_ENV[tier]} is not set; cannot query the ${tier} model`);
}

export interface BiGSliceOptions {
  inputDirectory: string;
  queryName: string;
  /** Which v3 model to query. Selects the workspace, and labels every result row. */
  tier: BiGSliceTier;
  outputDirectory?: string;
  threads?: number;
  logFile?: string;
}

export interface BiGSliceResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
}

export async function runBiGSlice(options: BiGSliceOptions): Promise<BiGSliceResult> {
  const {
    inputDirectory,
    queryName,
    tier,
    outputDirectory = tierWorkspace(tier),
    threads = Number(process.env.BIGSLICE_THREADS) || 16,
    logFile,
  } = options;

  const sanitizedQueryName = queryName.replace(/-/g, '_');
  
  try {
    await access(outputDirectory);
  } catch {
    await mkdir(outputDirectory, { recursive: true });
  }

  // Without --run_id BiG-SLiCE queries the latest run in the output folder.
  const runId = process.env.BIGSLICE_RUN_ID;

  // No `--threshold`: a no-op in query mode; the 0.4 rule is applied after parsing (CLUSTERING_THRESHOLD).
  const coreArgs = [
    '--query', inputDirectory,
    '-t', threads.toString(),
    '--query_name', sanitizedQueryName,
    '--n_ranks', QUERY_RANKS.toString(),
    ...(runId ? ['--run_id', runId] : []),
  ];

  // 'ssh-docker' runs on a remote host because large reference runs OOM on the app box.
  const execMode = process.env.BIGSLICE_EXEC_MODE || 'local';

  let command: string;
  let args: string[];

  if (execMode === 'ssh-docker') {
    const sshHost = process.env.BIGSLICE_SSH_HOST || 'docker-host';
    const image = process.env.BIGSLICE_DOCKER_IMAGE || 'bigslice:2.0.2';
    const cephMount = process.env.BIGSLICE_CEPH_MOUNT || '/data/bgc-atlas';
    const programDbFolder = process.env.BIGSLICE_PROGRAM_DB_FOLDER || '/opt/bigslice-models';
    // Run as the app's uid:gid so output under the ACL-owned folder is writable by us.
    const dockerUser = process.env.BIGSLICE_DOCKER_USER
      || (typeof process.getuid === 'function' && typeof process.getgid === 'function'
        ? `${process.getuid()}:${process.getgid()}`
        : '');

    command = 'ssh';
    args = [
      ...SSH_OPTS,
      sshHost,
      'docker', 'run', '--rm',
      ...(dockerUser ? ['--user', dockerUser] : []),
      '-v', `${cephMount}:${cephMount}`,
      image,
      'bigslice',
      ...coreArgs,
      // Models are baked into the image; the container's default model path is empty.
      '--program_db_folder', programDbFolder,
      outputDirectory,
    ];
  } else {
    const condaEnv = process.env.CONDA_ENV_NAME || 'bigslice';
    command = 'conda';
    args = ['run', '-n', condaEnv, 'bigslice', ...coreArgs, outputDirectory];
  }

  const commandString = `${command} ${args.join(' ')}`;
  console.log(`Executing BiG-SLiCE: ${commandString}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const logStream = logFile ? createWriteStream(logFile) : null;
    logStream?.write(`Executing BiG-SLiCE: ${commandString}\n\n`);

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      logStream?.write(chunk);
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      logStream?.write(chunk);
    });

    child.on('close', (exitCode) => {
      console.log(`BiG-SLiCE process exited with code: ${exitCode}`);
      logStream?.end();
      
      resolve({
        success: exitCode === 0,
        exitCode: exitCode || -1,
        stdout,
        stderr,
        command: `${command} ${args.join(' ')}`
      });
    });

    child.on('error', (error) => {
      console.error(`BiG-SLiCE process error:`, error);
      const errorMessage = '\n' + error.message;
      stderr += errorMessage;
      logStream?.write(errorMessage);
      logStream?.end();
      
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        command: `${command} ${args.join(' ')}`
      });
    });
  });
}

export interface BiGSliceQueryResult {
  origFilename: string;       // original uploaded filename (mapped back from the renamed file)
  bigsliceGcfId: number;      // raw gcf.id from the queried model -- meaningless without `tier`
  tier: BiGSliceTier;         // which v3 model produced it; the two id spaces are independent
  distance: number;           // membership distance to that GCF (lower = better fit)
  rank: number;               // assignment rank (0 = best)
}

export interface BiGSliceParseResult {
  queryName: string;
  results: BiGSliceQueryResult[];
  totalMatches: number;
}

/**
 * Reads {outputDir}/reports/<id>/data.db via a stdlib Python helper (the app has no SQLite driver).
 * Failures resolve to empty results. The report does not record its model, so `tier` is stamped
 * onto every row: the two models number families independently.
 */
export async function parseBiGSliceResults(
  outputDir: string,
  queryName: string,
  filenameMapPath: string,
  tier: BiGSliceTier
): Promise<BiGSliceParseResult> {
  const sanitizedQueryName = queryName.replace(/-/g, '_');
  const { join } = await import('path');

  const python = process.env.BIGSLICE_PYTHON || 'python3';
  const scriptPath = process.env.BIGSLICE_PARSE_SCRIPT
    || join(process.cwd(), 'src', 'lib', 'bigslice', 'parse_report.py');

  const empty: BiGSliceParseResult = { queryName: sanitizedQueryName, results: [], totalMatches: 0 };

  return new Promise((resolve) => {
    const child = spawn(python, [scriptPath, outputDir, sanitizedQueryName, filenameMapPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`parse_report.py exited ${code}: ${stderr}`);
        resolve(empty);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const rows: Omit<BiGSliceQueryResult, 'tier'>[] = Array.isArray(parsed.results) ? parsed.results : [];
        const results: BiGSliceQueryResult[] = rows.map((row) => ({ ...row, tier }));
        console.log(`Parsed ${results.length} BiG-SLiCE results for ${sanitizedQueryName}`);
        resolve({ queryName: sanitizedQueryName, results, totalMatches: results.length });
      } catch (error) {
        console.error('Failed to parse parse_report.py output:', error, stdout.slice(0, 500));
        resolve(empty);
      }
    });

    child.on('error', (error) => {
      console.error('parse_report.py spawn error:', error);
      resolve(empty);
    });
  });
}

function sshDockerImageExists(sshHost: string, image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...SSH_OPTS, sshHost, 'docker', 'image', 'inspect', image], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('close', (exitCode) => resolve(exitCode === 0));
    child.on('error', () => resolve(false));
  });
}

// Rebuilds the image from the shared build context (build.sh) when the host has cleaned it.
function sshDockerBuildImage(sshHost: string, image: string, buildContext: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`Rebuilding BiG-SLiCE image ${image} on ${sshHost} from ${buildContext}`);
    const child = spawn('ssh', [...SSH_OPTS, sshHost, 'sh', `${buildContext}/build.sh`, image], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => console.log(`[bigslice build] ${d.toString().trimEnd()}`));
    child.stderr?.on('data', (d) => console.log(`[bigslice build] ${d.toString().trimEnd()}`));
    child.on('close', (exitCode) => {
      console.log(`BiG-SLiCE image build exited with code: ${exitCode}`);
      resolve(exitCode === 0);
    });
    child.on('error', (error) => {
      console.error('BiG-SLiCE image build error:', error);
      resolve(false);
    });
  });
}

export async function checkBiGSliceAvailability(): Promise<boolean> {
  const execMode = process.env.BIGSLICE_EXEC_MODE || 'local';

  // The remote host periodically cleans images, so a missing one is rebuilt and re-checked.
  if (execMode === 'ssh-docker') {
    const sshHost = process.env.BIGSLICE_SSH_HOST || 'docker-host';
    const image = process.env.BIGSLICE_DOCKER_IMAGE || 'bigslice:2.0.2';

    if (await sshDockerImageExists(sshHost, image)) {
      return true;
    }

    const buildContext = process.env.BIGSLICE_BUILD_CONTEXT || '/data/bgc-atlas/docker/bigslice';
    console.warn(`BiG-SLiCE image ${image} not found on ${sshHost}; attempting rebuild from ${buildContext}`);
    const built = await sshDockerBuildImage(sshHost, image, buildContext);
    if (!built) {
      return false;
    }
    return sshDockerImageExists(sshHost, image);
  }

  const condaEnv = process.env.CONDA_ENV_NAME || 'bigslice';

  return new Promise((resolve) => {
    const child = spawn('conda', ['run', '-n', condaEnv, 'which', 'bigslice'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.on('close', (exitCode) => {
      resolve(exitCode === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}