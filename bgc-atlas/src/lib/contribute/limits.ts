// nginx rejects bodies over 500 MB (client_max_body_size) with its own 413 page, so the assembly
// gets what is left after the metadata file and multipart overhead.
const MIB = 1024 * 1024;

export const CONTRIBUTE_REQUEST_MAX_BYTES = 500 * MIB; // nginx client_max_body_size
export const CONTRIBUTE_METADATA_MAX_BYTES = 1 * MIB;
export const CONTRIBUTE_ASSEMBLY_MAX_BYTES = 490 * MIB;
export const CONTRIBUTE_MAX_ASSEMBLY_FILES = 1;

/** "490 MB" -- binary units, matching how the route reports sizes. */
export const CONTRIBUTE_ASSEMBLY_MAX_LABEL = `${CONTRIBUTE_ASSEMBLY_MAX_BYTES / MIB} MB`;
