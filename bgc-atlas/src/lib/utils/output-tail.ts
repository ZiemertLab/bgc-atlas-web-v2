/**
 * How much of a child process's stdout or stderr is kept in memory: its last 64 KB.
 *
 * DIAMOND and BiG-SLiCE runs last minutes to hours and log progress the whole time,
 * and their output was accumulated whole -- for one stored error message of at most
 * 5,000 characters, and a 1,000-character excerpt in the session's JSON. The full
 * output still goes to the session's log file.
 */
export const OUTPUT_TAIL_CHARS = 64 * 1024;

/** `buffer + chunk`, cut back to its last `max` characters. */
export function appendTail(buffer: string, chunk: string, max: number = OUTPUT_TAIL_CHARS): string {
  const next = buffer + chunk;
  return next.length > max ? next.slice(next.length - max) : next;
}
