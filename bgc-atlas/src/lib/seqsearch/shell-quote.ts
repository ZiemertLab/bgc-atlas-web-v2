// Quoting for commands run on a remote host over ssh.
//
// ssh does not pass an argv to the remote side: it joins every argument after the host with
// spaces and hands that one string to the remote login shell. So `spawn('ssh', [host, 'diamond',
// '--max-target-seqs', value])` runs `value` through a shell on the far end, and an unquoted
// `$(…)` or `;` in it executes there. Every remote argument goes through shellQuote.

/** Characters a POSIX shell treats as plain text, left unquoted so logged commands stay readable. */
const PLAIN_RE = /^[A-Za-z0-9_/.,:=@%+-]+$/;

/** Quote one argument so a POSIX shell reads it back as exactly that string. */
export function shellQuote(arg: string): string {
  if (PLAIN_RE.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The single remote-command argument for ssh, built from an argv. */
export function remoteCommand(args: readonly string[]): string {
  return args.map(shellQuote).join(' ');
}

// Docker's own rule for a container name.
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/**
 * `docker run --rm --name <name> ...` as one remote command line, preceded by removing any
 * container already running under that name.
 *
 * A container outlives its ssh client: a pm2 restart kills the app and the ssh child, the
 * container keeps running on the remote host, and BullMQ then starts
 * the stalled job again. Without a name the re-run raced the orphan -- two DIAMOND scans of
 * the same index writing one output file, or a BiG-SLiCE run against a half-written report.
 * Named per job, the re-run replaces it.
 */
export function replacingDockerRun(name: string, runArgs: readonly string[]): string {
  if (!CONTAINER_NAME_RE.test(name)) throw new Error(`Invalid container name: ${name}`);
  return `${remoteCommand(['docker', 'rm', '-f', name])} >/dev/null 2>&1; `
    + remoteCommand(['docker', 'run', '--rm', '--name', name, ...runArgs]);
}
