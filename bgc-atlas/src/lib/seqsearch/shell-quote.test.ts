import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

import { remoteCommand, shellQuote } from './shell-quote';

// What a remote POSIX shell makes of the string: the arguments it sees, NUL-separated.
function shellArgv(command: string): string[] {
  const out = spawnSync('sh', ['-c', `for a in ${command}; do printf '%s\\0' "$a"; done`], {
    encoding: 'utf8',
  });
  return out.stdout.split('\0').slice(0, -1);
}

describe('shellQuote', () => {
  it('leaves plain paths, flags and numbers readable', () => {
    expect(shellQuote('--max-target-seqs')).toBe('--max-target-seqs');
    expect(shellQuote('/data/bgc-atlas/sessions/x/query.fasta')).toBe(
      '/data/bgc-atlas/sessions/x/query.fasta',
    );
    expect(shellQuote('1e-5')).toBe('1e-5');
    expect(shellQuote('1000:1000')).toBe('1000:1000');
  });

  it('quotes the empty string rather than dropping it', () => {
    expect(shellArgv(remoteCommand(['a', '', 'b']))).toEqual(['a', '', 'b']);
  });
});

describe('remoteCommand', () => {
  it('hands a shell back exactly the argv it was given, metacharacters inert', () => {
    const argv = [
      'diamond', '--max-target-seqs', '1 $(touch /tmp/pwned)', '`id`', "it's", 'a;b', 'x|y',
      '&& rm -rf /', '$HOME', '*', 'new\nline', '"double"',
    ];
    expect(shellArgv(remoteCommand(argv))).toEqual(argv);
  });
});
