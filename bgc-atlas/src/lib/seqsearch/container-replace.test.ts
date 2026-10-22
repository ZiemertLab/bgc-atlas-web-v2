import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A remote container is named per job, and a run first removes any container left under
 * its name. Killing the app (a pm2 restart) leaves the container running on the remote
 * Docker host, and BullMQ then re-runs the stalled job; without a name
 * the re-run raced the orphan for the same output files.
 */

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', async (orig) => ({ ...(await orig<typeof import('child_process')>()), spawn }));

import { replacingDockerRun } from './shell-quote';
import { buildSeqSearchCommand } from './exec';
import { runBiGSlice } from '@/lib/bigslice';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';

afterEach(() => {
  vi.unstubAllEnvs();
  spawn.mockReset();
});

describe('replacingDockerRun', () => {
  it('removes the named container, then runs a new one under the same name', () => {
    expect(replacingDockerRun('atlas-diamond-s1', ['img', 'diamond', 'blastp'])).toBe(
      'docker rm -f atlas-diamond-s1 >/dev/null 2>&1; docker run --rm --name atlas-diamond-s1 img diamond blastp',
    );
  });

  it('still quotes every run argument', () => {
    expect(replacingDockerRun('n', ['img', 'a b', '$(x)'])).toMatch(/ 'a b' '\$\(x\)'$/);
  });

  it.each(['', '-x', 'a b', 'a;rm -rf /', 'a/b'])('refuses %j as a container name', (name) => {
    expect(() => replacingDockerRun(name, ['img'])).toThrow(/Invalid container name/);
  });
});

describe('buildSeqSearchCommand', () => {
  it('names the container in ssh-docker mode when asked', () => {
    vi.stubEnv('SEQSEARCH_EXEC_MODE', 'ssh-docker');
    const { command, args } = buildSeqSearchCommand('env', 'diamond:2', ['diamond', 'blastp'], 'atlas-diamond-s1');
    expect(command).toBe('ssh');
    expect(args.at(-1)).toMatch(/^docker rm -f atlas-diamond-s1 >\/dev\/null 2>&1; docker run --rm --name atlas-diamond-s1 /);
    expect(args.at(-1)).toMatch(/ diamond:2 diamond blastp$/);
  });

  it('runs unnamed without a name, as before', () => {
    vi.stubEnv('SEQSEARCH_EXEC_MODE', 'ssh-docker');
    const { args } = buildSeqSearchCommand('env', 'diamond:2', ['diamond']);
    expect(args.at(-1)).toMatch(/^docker run --rm /);
  });
});

describe('runBiGSlice', () => {
  it('names its container and passes the report name it was given', async () => {
    vi.stubEnv('BIGSLICE_EXEC_MODE', 'ssh-docker');
    spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
      setImmediate(() => child.emit('close', 0));
      return child;
    });
    await runBiGSlice({
      inputDirectory: '/ceph/in',
      outputDirectory: tmpdir(), // exists, so nothing is created
      queryName: 'aaaa-bbbb_k1',
      tier: 'seed',
      containerName: 'atlas-bigslice-aaaa-bbbb-seed',
    });
    const remote = (spawn.mock.calls[0][1] as string[]).at(-1)!;
    expect(remote).toMatch(/^docker rm -f atlas-bigslice-aaaa-bbbb-seed >\/dev\/null 2>&1; docker run --rm --name atlas-bigslice-aaaa-bbbb-seed /);
    expect(remote).toMatch(/--query_name aaaa_bbbb_k1 /);
  });
});
