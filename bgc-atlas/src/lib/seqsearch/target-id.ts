// DIAMOND target ids are `<region-uuid>_ctg<N>_<cds#>`; the region UUID is `bgcs.id`
// (both are the uuid5 of the region filename).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedTargetId {
  regionId: string | null;
  /** e.g. `ctg1_1177`; the whole id when unparsed. */
  cdsLabel: string;
}

export function parseTargetId(targetId: string): ParsedTargetId {
  // Split at a fixed offset; contig labels may contain underscores.
  const prefix = targetId.slice(0, 36);
  const separator = targetId.charAt(36);

  if (separator === '_' && UUID_RE.test(prefix)) {
    return { regionId: prefix.toLowerCase(), cdsLabel: targetId.slice(37) };
  }
  return { regionId: null, cdsLabel: targetId };
}
