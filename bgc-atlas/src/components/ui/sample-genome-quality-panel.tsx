'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatRow } from '@/components/ui/stat-leader-row';
import { Sample } from '@/lib/types';
import {
  completenessBand, contaminationBand,
  COMPLETENESS_NOTE, CONTAMINATION_NOTE, MIMAG_BADGE_CLASS, MIMAG_TEXT_CLASS,
} from '@/lib/utils/mimag';

interface SampleGenomeQualityPanelProps {
  sample: Sample;
}

interface Row {
  label: string;
  value: string;
  valueClassName?: string;
  title?: string;
}

const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

// QC columns are promoted onto `samples`; other assembly stats come from the metadata JSONB.
export function SampleGenomeQualityPanel({ sample }: SampleGenomeQualityPanelProps) {
  const meta = (sample.metadata ?? {}) as Record<string, unknown>;
  const metaNum = (key: string): number | undefined => {
    const v = meta[key];
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const metaStr = (key: string): string | undefined => {
    const v = meta[key];
    return v === undefined || v === null || v === '' ? undefined : String(v);
  };

  const qualityColor =
    sample.genomeQuality === 'high' || sample.genomeQuality === 'medium'
      ? MIMAG_BADGE_CLASS[sample.genomeQuality]
      : MIMAG_BADGE_CLASS.low;

  // Only the two CheckM figures carry status (MIMAG bands, lib/utils/mimag.ts),
  // coloured as in the table's CheckM columns; the rest are plain.
  const completeness = sample.checkmCompleteness;
  const contamination = sample.checkmContamination;
  const qualityRows: Row[] = [];
  if (completeness != null) {
    const band = completenessBand(completeness);
    qualityRows.push({ label: 'Completeness', value: `${fmt(completeness, 2)} %`,
                       valueClassName: MIMAG_TEXT_CLASS[band], title: COMPLETENESS_NOTE[band] });
  }
  if (contamination != null) {
    const band = contaminationBand(contamination);
    qualityRows.push({ label: 'Contamination', value: `${fmt(contamination, 2)} %`,
                       valueClassName: MIMAG_TEXT_CLASS[band], title: CONTAMINATION_NOTE[band] });
  }
  if (sample.genomeSize != null) {
    qualityRows.push({ label: 'Genome size', value: `${fmt(sample.genomeSize / 1_000_000, 2)} Mb` });
  }

  const assemblyRows: Row[] = [];
  const pushMeta = (label: string, key: string, unit: string, digits = 0) => {
    const v = metaNum(key);
    if (v !== undefined) assemblyRows.push({ label, value: `${fmt(v, digits)}${unit}` });
  };
  pushMeta('GC content', 'gc_percentage', ' %', 2);
  pushMeta('N50 (contigs)', 'n50_contigs', ' bp');
  pushMeta('Contigs', 'contig_count', '');
  pushMeta('Coding density', 'coding_density', ' %', 2);
  pushMeta('tRNAs', 'trna_count', '');

  // Every genome carries CheckM2, from our own run or from GTDB R232's for GTDB genomes;
  // the source differs, so a value never appears without saying which.
  const provenance = [sample.checkmTool, sample.checkmSource ? `from ${sample.checkmSource}` : null]
    .filter(Boolean).join(', ');
  const gtdbTaxonomy = metaStr('gtdb_taxonomy');
  const ncbiTaxonomy = metaStr('ncbi_taxonomy');
  const biosample = metaStr('biosample') ?? metaStr('ncbi_biosample');

  const hasAnything =
    qualityRows.length > 0 || assemblyRows.length > 0 || gtdbTaxonomy || ncbiTaxonomy || biosample;

  return (
    <Card>
      <CardContent>
        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">No genome-quality metadata recorded for this sample.</p>
        ) : (
          <div className="space-y-6">
            {(qualityRows.length > 0 || assemblyRows.length > 0) && (
              <div className="grid gap-6 md:grid-cols-[repeat(2,minmax(0,22rem))] md:gap-12">
                {qualityRows.length > 0 && (
                  <div className="min-w-0">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="section-label">Quality</span>
                      {sample.genomeQuality ? (
                        <Badge variant="outline" className={`text-[10px] uppercase ${qualityColor}`}>
                          {sample.genomeQuality}
                        </Badge>
                      ) : null}
                    </div>
                    <dl className="space-y-1 text-sm">
                      {qualityRows.map((r) => <StatRow key={r.label} {...r} />)}
                    </dl>
                    {provenance && <p className="mt-2 text-xs text-muted-foreground">{provenance}</p>}
                  </div>
                )}
                {assemblyRows.length > 0 && (
                  <div className="min-w-0">
                    <div className="section-label mb-2.5">Assembly</div>
                    <dl className="space-y-1 text-sm">
                      {assemblyRows.map((r) => <StatRow key={r.label} {...r} />)}
                    </dl>
                  </div>
                )}
              </div>
            )}

            {(gtdbTaxonomy || ncbiTaxonomy || biosample) && (
              <div>
                <div className="section-label mb-2.5">Taxonomy &amp; identifiers</div>
                <dl className="space-y-1 text-sm">
                  {gtdbTaxonomy && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">GTDB</dt>
                      <dd className="min-w-0 font-mono text-xs break-all">{gtdbTaxonomy}</dd>
                    </div>
                  )}
                  {ncbiTaxonomy && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">NCBI</dt>
                      <dd className="min-w-0 font-mono text-xs break-all">{ncbiTaxonomy}</dd>
                    </div>
                  )}
                  {biosample && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">BioSample</dt>
                      <dd className="min-w-0">
                        <a
                          href={`https://www.ncbi.nlm.nih.gov/biosample/${biosample}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
                        >
                          {biosample}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
