const GTDB_PREFIX_REGEX = /(RS|GB)_((?:GCF|GCA)_[A-Z0-9]+(?:\.[0-9]+)?)/i;
const GTDB_FALLBACK_REGEX = /((?:GCF|GCA)_[A-Z0-9]+(?:\.[0-9]+)?)/i;

export const normalizeGtdbId = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutPrefix = trimmed.replace(/^(RS|GB)_/i, '');
  const clean = withoutPrefix
    .replace(/[\s]+/g, ' ')
    .split(/[\s,;]+/)[0]
    .replace(/[^A-Za-z0-9._-]/g, '_');
  return clean.toUpperCase();
};

// e.g. RS_GCF_002895405.1 -> GCF_002895405.1
export const extractGtdbAssemblyId = (value: unknown): string | null => {
  if (typeof value === 'number') {
    return extractGtdbAssemblyId(String(value));
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const prefixed = trimmed.match(GTDB_PREFIX_REGEX);
  if (prefixed) {
    return normalizeGtdbId(prefixed[2]);
  }
  const fallback = trimmed.match(GTDB_FALLBACK_REGEX);
  if (fallback) {
    return normalizeGtdbId(fallback[1]);
  }
  if (/^(RS|GB)_/i.test(trimmed)) {
    return normalizeGtdbId(trimmed.replace(/^(RS|GB)_/i, ''));
  }
  if (/^(?:GCF|GCA)_/i.test(trimmed)) {
    return normalizeGtdbId(trimmed);
  }
  return null;
};

export const buildGtdbGenomeUrl = (assemblyId: string) =>
  `https://gtdb.ecogenomic.org/genome?gid=${encodeURIComponent(assemblyId)}`;

const ENV_LINK_BUILDERS: Record<string, (encodedId: string) => string> = {
  mgnify: (id) => `https://www.ebi.ac.uk/metagenomics/samples/${id}`,
  metalog: (id) => `https://metalog.embl.de/search?query=${id}`,
  spire: (id) => `https://spire.embl.de/sample/${id}`,
};

export function buildDataSourceUrl(sourceName: string, sampleExternalId: string | null): string | null {
  if (!sampleExternalId) return null;
  const lower = sourceName.toLowerCase();

  if (lower.includes('gtdb')) {
    const gid = extractGtdbAssemblyId(sampleExternalId);
    return gid ? buildGtdbGenomeUrl(gid) : null;
  }

  const buildEnvUrl = ENV_LINK_BUILDERS[lower];
  return buildEnvUrl ? buildEnvUrl(encodeURIComponent(sampleExternalId)) : null;
}
