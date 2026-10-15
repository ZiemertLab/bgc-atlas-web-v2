/**
 * The ten most abundant phyla get fixed colours so they match across charts and reloads;
 * everything else gets a hue hashed from its name. Okabe-Ito sky and pink are left out:
 * they collapse against this set's purple and blue under simulated deuteranopia.
 */

export const DOMAIN_COLORS = {
  bacteria: '#0072B2',
  archaea: '#E69F00',
  eukaryota: '#009E73',
  unknown: '#6b7280',
} as const;

export const PHYLUM_COLORS: Record<string, string> = {
  pseudomonadota: '#0072b2',
  bacillota: '#d55e00',
  bacteroidota: '#009e73',
  actinomycetota: '#785ef0',
  acidobacteriota: '#e69f00',
  verrucomicrobiota: '#8b5a2b',
  desulfobacterota: '#7f0000',
  chloroflexota: '#228833',
  planctomycetota: '#882255',
  cyanobacteriota: '#00373d',
};

// Pre-2021 names from non-GTDB sources. Suffixed GTDB phyla (Bacillota_A, …) are not
// folded in: GTDB splits them out because they are not the parent phylum.
const PHYLUM_SYNONYMS: Record<string, string> = {
  proteobacteria: 'pseudomonadota',
  firmicutes: 'bacillota',
  bacteroidetes: 'bacteroidota',
  actinobacteria: 'actinomycetota',
  actinobacteriota: 'actinomycetota',
  acidobacteria: 'acidobacteriota',
  verrucomicrobia: 'verrucomicrobiota',
  chloroflexi: 'chloroflexota',
  planctomycetes: 'planctomycetota',
  cyanobacteria: 'cyanobacteriota',
};

// For compound labels like "d__Bacteria; p__Actinobacteriota", keeps the most specific segment.
export function normalizeTaxonKey(taxon: string | null | undefined): string {
  if (!taxon) return 'unknown';

  const cleaned = taxon.trim();
  if (!cleaned) return 'unknown';

  const segments = cleaned
    .split(/[;|]/)
    .map(segment => segment.trim())
    .filter(Boolean);

  const leaf = segments.length ? segments[segments.length - 1] : cleaned;
  const key = leaf.replace(/^[a-z]__/, '').toLowerCase();
  return PHYLUM_SYNONYMS[key] ?? key;
}

// Never grey or black: those are reserved for unknown.
const TAXON_SATURATION = 0.62;
const TAXON_LIGHTNESS = 0.5;

/** h in degrees, s/l in 0..1. */
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** FNV-1a. */
function hashHue(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

const COLOR_CACHE = new Map<string, string>();

export function stableTaxonColor(taxon: string | null | undefined): string {
  const key = normalizeTaxonKey(taxon);

  if (key in DOMAIN_COLORS) return DOMAIN_COLORS[key as keyof typeof DOMAIN_COLORS];
  if (key in PHYLUM_COLORS) return PHYLUM_COLORS[key];

  const cached = COLOR_CACHE.get(key);
  if (cached) return cached;

  const color = hslToHex(hashHue(key), TAXON_SATURATION, TAXON_LIGHTNESS);
  COLOR_CACHE.set(key, color);
  return color;
}

// Keyed on the row's phylum whatever rank is shown, except at domain rank, where two
// "Bacteria" rows must match.
export function taxonomyColorFor(
  rank: string,
  phylum: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  if (rank === 'domain') return domain ? stableTaxonColor(domain) : null;
  if (phylum) return stableTaxonColor(phylum);
  return domain ? stableTaxonColor(domain) : null;
}
