/**
 * BiG-SLiCE upload limits, shared by the search page and POST /api/search/bigslice/submit.
 *
 * nginx refuses any request body over 500 MiB (`client_max_body_size 500m`) before
 * it reaches Next, with its own HTML 413 page. The route allowed 500 MiB of files
 * PLUS 10 MiB of multipart overhead, so its own "too large" answer could never be
 * reached and an upload near the limit got nginx's page, which the form could not
 * parse. The files get what is left after the overhead, as for /contribute.
 */
const MIB = 1024 * 1024;

export const BIGSLICE_MAX_FILES = 100;
export const BIGSLICE_MAX_FILE_BYTES = 50 * MIB;
export const BIGSLICE_MULTIPART_OVERHEAD_BYTES = 10 * MIB;
export const BIGSLICE_REQUEST_MAX_BYTES = 500 * MIB; // nginx client_max_body_size
export const BIGSLICE_MAX_TOTAL_BYTES = BIGSLICE_REQUEST_MAX_BYTES - BIGSLICE_MULTIPART_OVERHEAD_BYTES;

/** "50 MB" -- binary units, as the route reports sizes. */
export const mib = (bytes: number) => `${bytes / MIB} MB`;
