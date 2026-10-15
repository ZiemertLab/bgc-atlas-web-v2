'use client';

import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from '@/components/ui/collapsible-section';

interface SampleMetadataShape {
  species?: string;
  studies?: string | string[] | unknown;
  biosample?: string;
  ncbi_biosample?: string;
  description?: string;
  last_update?: string;
  biome?: { lineage?: string };
  environment?: { biome?: string; material?: string; feature?: string };
  sample_meta_map?: {
    host_taxid?: Array<{ value?: string }>;
    host_scientific_name?: Array<{ value?: string }>;
  };
  [key: string]: unknown;
}

interface MetadataDetailsSample {
  metadata?: SampleMetadataShape | null;
  id?: string | null;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  hostSpecies?: string | null;
  studyDescription?: string | null;
  env_terms?: unknown;
  latitude?: number | null;
  longitude?: number | null;
  location?: string | null;
  // Top-level columns (e.g. GTDB genomes) rather than nested metadata.
  environment?: string | null;
  environmentBiome?: string | null;
  environmentFeature?: string | null;
  environmentMaterial?: string | null;
  collectionDate?: string | null;
}

interface MetadataDetailsProps {
  sample: MetadataDetailsSample | null | undefined;
}

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
};

const LINK = 'text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';

// Location, environment, collection date and studies each have their own tab;
// this one lists what identifies the sample and nothing else, and only the
// fields that are actually set -- no "N/A" rows.
export function MetadataDetails({ sample }: MetadataDetailsProps) {
  if (!sample) return null;
  const metadata = (sample.metadata && typeof sample.metadata === 'object' ? sample.metadata : {}) as SampleMetadataShape;

  const biosample = str(metadata.biosample ?? metadata.ncbi_biosample);
  const hostTaxid = str(metadata.sample_meta_map?.host_taxid?.[0]?.value);
  const hostName = str(sample.hostSpecies) ?? str(metadata.sample_meta_map?.host_scientific_name?.[0]?.value);
  const taxonomyHref = (q: string, byId: boolean) =>
    `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?${byId ? 'id' : 'name'}=${encodeURIComponent(q)}`;

  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [];
  const add = (label: string, value: React.ReactNode | undefined, mono = false) => {
    if (value !== undefined && value !== null && value !== '') rows.push({ label, value, mono });
  };
  add('Name', str(sample.name));
  add('Type', str(sample.type));
  add('Species', str(metadata.species));
  add('BioSample', biosample && (
    <a href={`https://www.ncbi.nlm.nih.gov/biosample/${encodeURIComponent(biosample)}`}
       target="_blank" rel="noopener noreferrer" className={LINK}>{biosample}</a>
  ), true);
  add('Host', hostName && (
    <a href={hostTaxid ? taxonomyHref(hostTaxid, true) : taxonomyHref(hostName, false)}
       target="_blank" rel="noopener noreferrer" className={`italic ${LINK}`}>{hostName}</a>
  ));
  add('Description', str(metadata.description));
  add('Last updated', str(metadata.last_update));
  add('Atlas ID', str(sample.id), true);

  const hasRecord = Object.keys(metadata).length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <dl className="space-y-1.5 text-sm">
            {rows.map(({ label, value, mono }) => (
              <div key={label} className="flex gap-3">
                <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
                <dd className={`min-w-0 break-words ${mono ? 'font-mono text-xs leading-5' : ''}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {hasRecord && (
        <CollapsibleSection title="Source record" badge="JSON">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  );
}
