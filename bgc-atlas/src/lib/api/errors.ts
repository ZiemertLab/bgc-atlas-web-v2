import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { withReference } from './error-messages';

// The real error goes to the server log under a reference; nothing about what broke leaves the server.
export { SERVER_ERROR_MESSAGE } from './error-messages';

/** A message written for the reader; serverError passes it through with its own status. */
export class UserFacingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export const errorReference = (): string => randomBytes(3).toString('hex');

// `grep 'ref a3f9c2' ~/.pm2/logs/bgc-atlas-v2-error.log` finds the entry.
export function logServerError(error: unknown, context: string): { message: string; reference: string } {
  const reference = errorReference();
  console.error(`[ref ${reference}] ${context}:`, error);
  return { message: withReference(reference), reference };
}

// Aggregation routes answer 502 rather than 500 so the page falls back to the corpus-wide view.
export interface ErrorBody {
  success: false;
  error: string;
  /** Quote this to find the log entry; absent for a UserFacingError. */
  reference?: string;
}

export function serverError(
  error: unknown,
  context: string,
  { status = 500, headers }: { status?: number; headers?: HeadersInit } = {},
): NextResponse<ErrorBody> {
  if (error instanceof UserFacingError) {
    return NextResponse.json<ErrorBody>({ success: false, error: error.message }, { status: error.status, headers });
  }
  const { message, reference } = logServerError(error, context);
  return NextResponse.json<ErrorBody>({ success: false, error: message, reference }, { status, headers });
}

// Stored job failures written for the reader; any other `error_message` is raw and replaced.
const READER_JOB_ERRORS = new Set([
  'Job canceled by administrator',
  'Search was interrupted when the server restarted and could not be recovered. Please submit it again.',
]);

/**
 * Raw failures whose cause is the reader's input, translated rather than shown.
 * The raw text stays in `error_message`; only what the reader sees changes. Without
 * this, a failure that will recur on every attempt is answered with "Please start it again".
 */
const RECOGNISED_JOB_ERRORS: ReadonlyArray<{ match: RegExp; message: string }> = [
  {
    // BiG-SLiCE found no BGC in any uploaded file and sklearn failed on the empty
    // feature matrix. The submit route rejects such files up front
    // (lib/bigslice/genbank-usability.ts); this covers whatever slips past it.
    match: /BiG-SLiCE \w+ query failed[\s\S]*Found array with 0 sample\(s\)/,
    message:
      'BiG-SLiCE found no gene cluster region in the uploaded files, so there was nothing to compare. ' +
      'Upload the regionNNN.gbk files antiSMASH wrote; to search a gene or protein sequence, use Sequence similarity.',
  },
];

/**
 * What a reader is told about a failed export or search: the stored message if
 * it was written for them, a translation if the raw failure is a recognised one,
 * otherwise a fixed one. The job id in the page's URL is the reference.
 */
export function publicJobError(kind: 'export' | 'search', stored: string | null | undefined): string {
  if (stored && READER_JOB_ERRORS.has(stored)) return stored;
  const recognised = stored ? RECOGNISED_JOB_ERRORS.find(({ match }) => match.test(stored)) : undefined;
  if (recognised) return recognised.message;
  return `This ${kind} could not be completed. Please start it again; if it keeps failing, let us know.`;
}

// Extraction errors name archive paths on disk, so they are logged, not shown.
export function antismashFailureMessage(
  status: string,
  internal: string | null | undefined,
  context: string,
): string {
  if (status === 'missing-file') {
    console.warn(`${context}: ${internal ?? 'missing file'}`);
    return 'The antiSMASH results for this region are not available.';
  }
  return logServerError(new Error(internal ?? 'unknown failure'), context).message;
}
