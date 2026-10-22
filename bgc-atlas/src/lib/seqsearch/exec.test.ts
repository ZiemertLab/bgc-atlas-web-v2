import { describe, expect, it } from 'vitest';

import { classifyImageInspect } from './exec';

// Messages as docker 29 and OpenSSH print them.
describe('classifyImageInspect', () => {
  it('reads exit 0 as present', () => {
    expect(classifyImageInspect(0, '')).toBe('present');
  });

  it("reads docker's own 'No such image' as missing", () => {
    expect(classifyImageInspect(1, 'Error response from daemon: No such image: bigslice:2.0.2\n')).toBe('missing');
    expect(classifyImageInspect(1, 'Error: No such object: diamond:2.2.2\n')).toBe('missing');
  });

  it('does not read an ssh failure as a missing image', () => {
    expect(classifyImageInspect(255, 'ssh: connect to host docker-host port 22: Connection timed out\n')).toBe('unchecked');
  });

  it('does not read an unreachable docker daemon as a missing image, though it also exits 1', () => {
    expect(
      classifyImageInspect(1, 'failed to connect to the docker API at unix:///var/run/docker.sock; check if the daemon is running\n')
    ).toBe('unchecked');
  });

  it('does not read a killed ssh (no exit code) as a missing image', () => {
    expect(classifyImageInspect(null, '')).toBe('unchecked');
  });
});
