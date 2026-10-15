import type { Sample } from '@/lib/types';

// A GCF count is bounded by how much of the sample could be clustered, so it never appears
// without its coverage (here in the title attribute).

/** The header tooltip that has to accompany the column wherever it is used. */
export const SAMPLE_GCF_HEADER_TOOLTIP =
  'Distinct gene cluster families among this sample’s BGCs';

export function sampleGcfTooltip(sample: Pick<Sample, 'gcfCount' | 'clusteredBgcCount' | 'unclusteredBgcCount'>) {
  const clustered = sample.clusteredBgcCount ?? 0;
  const unclustered = sample.unclusteredBgcCount ?? 0;
  const total = clustered + unclustered;
  if (!sample.gcfCount) {
    return `No BGC of this sample belongs to a family at resolution 0.4${
      total ? ` — all ${total.toLocaleString()} are unclustered` : ''
    }.`;
  }
  return (
    `${sample.gcfCount.toLocaleString()} ${sample.gcfCount === 1 ? 'family' : 'families'} `
    + `across ${clustered.toLocaleString()} of ${total.toLocaleString()} BGCs. `
    + `${unclustered.toLocaleString()} ${unclustered === 1 ? 'BGC belongs' : 'BGCs belong'} `
    + 'to no family at 0.4.'
  );
}

export function SampleGcfCount({ sample }: { sample: Sample }) {
  // /api/assemblies does not carry these counts; an em dash, since 0 would read as "clustered nothing".
  if (sample.gcfCount === null || sample.gcfCount === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={`font-medium tabular-nums ${sample.gcfCount > 0 ? 'text-foreground' : 'text-muted-foreground'}`}
      title={sampleGcfTooltip(sample)}
    >
      {sample.gcfCount.toLocaleString()}
    </span>
  );
}
