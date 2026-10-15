// Links facet values that are real identifiers. Targets are chosen by value, not just field:
// CompaRiPPson mixes MIBiG and NCBI accessions in one facet.

export type BucketLinkKind = 'gcf' | 'mibig' | 'ncbi' | 'gtdb';

export interface BucketLink {
  href: string;
  external: boolean;
  kind: BucketLinkKind;
  /** Tooltip text. */
  title: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MIBiG 4.x resolves versioned accessions only (BGC0001758.4); unversioned ones are a 404.
const MIBIG = /^BGC\d{7}\.\d+$/;
// GenBank/RefSeq nucleotide: DQ230532, NZ_CP032848, NZ_KZ819178.1.
const NCBI = /^[A-Z]{1,2}_?[A-Z0-9]{4,}(\.\d+)?$/;

const TAX_FIELDS = new Set([
  'tax_domain', 'tax_phylum', 'tax_class', 'tax_order', 'tax_family', 'tax_genus', 'tax_species',
]);

// In match order.
const FIELD_KINDS: Record<string, BucketLinkKind[]> = {
  gcf_id: ['gcf'],
  knowncluster_hits: ['mibig'],
  mibig_comparison_top: ['mibig'],
  comparippson_hits: ['mibig', 'ncbi'],
  clusterblast_hits: ['ncbi'],
  subcluster_hits: ['ncbi'],
};

const stripRank = (s: string) => s.replace(/^[a-z]__/, '');

function resolve(kind: BucketLinkKind, value: string, label: string): BucketLink | null {
  switch (kind) {
    case 'gcf':
      if (!UUID.test(value)) return null;
      return { href: `/gcfs/${value}`, external: false, kind, title: `Open ${label} in the Atlas` };
    case 'mibig':
      if (!MIBIG.test(value)) return null;
      return {
        href: `https://mibig.secondarymetabolites.org/repository/${value}/`,
        external: true, kind, title: `${value} in the MIBiG repository`,
      };
    case 'ncbi':
      // BGC accessions also satisfy the loose NCBI shape; MIBiG owns those.
      if (MIBIG.test(value) || value.startsWith('BGC') || !NCBI.test(value)) return null;
      return {
        href: `https://www.ncbi.nlm.nih.gov/nuccore/${value}`,
        external: true, kind, title: `${value} in NCBI Nucleotide`,
      };
    case 'gtdb': {
      const name = stripRank(value).trim();
      if (!name) return null;
      return {
        href: `https://gtdb.ecogenomic.org/searches?s=al&q=${encodeURIComponent(name)}`,
        external: true, kind, title: `${name} in GTDB`,
      };
    }
    default:
      return null;
  }
}

// `label` is the displayed name (GCF buckets are keyed by uuid but shown by name).
export function bucketLink(field: string, value: string, label = value): BucketLink | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  const kinds = TAX_FIELDS.has(field) ? (['gtdb'] as BucketLinkKind[]) : FIELD_KINDS[field];
  if (!kinds) return null;

  for (const kind of kinds) {
    const link = resolve(kind, raw, label);
    if (link) return link;
  }
  return null;
}
