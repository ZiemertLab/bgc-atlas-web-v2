'use client';

import { useState } from 'react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useGcfTaxonomyComposition } from '@/lib/hooks/use-gcf-taxonomy-composition';
import { TAXONOMY_RANKS } from '@/lib/opensearch/taxonomy-composition';
import { PURITY_CUTOFFS, type PurityCutoff } from '@/lib/opensearch/gcf-taxonomy-composition';
import {
  RANK_LABEL, RANK_PLURAL, TaxonomyCompositionPlaceholder, TaxonomyCompositionView,
} from './taxonomy-composition-view';
import type { UseGcfsParams } from '@/lib/hooks/use-gcfs';
import type { TaxonomyRank } from '@/lib/types';

// A family is filed under its largest taxon at the chosen rank only if that taxon clears the
// purity cutoff; otherwise it has no dominant taxon. Hence the cutoff is a visible control.

interface Props {
  /** The params the table passes to `useGcfs`. */
  params: UseGcfsParams;
  filtered?: boolean;
}

const NOUN = { one: 'family', many: 'families' };

export function GcfTaxonomyComposition({ params, filtered = false }: Props) {
  const [rank, setRank] = useState<TaxonomyRank>('phylum');
  const [purity, setPurity] = useState<PurityCutoff>(50);
  const { data, unsupported, isLoading, isFetching, error } = useGcfTaxonomyComposition(params, rank, purity);
  const refreshing = isFetching && !isLoading;

  const controls = (
    <>
      <Select value={String(purity)} onValueChange={(v) => setPurity(Number(v) as PurityCutoff)}>
        {/* At 130px "≥50% one taxon" truncated to "≥50% one t". */}
        <SelectTrigger className="w-full sm:w-[168px]" aria-label="Purity cutoff">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PURITY_CUTOFFS.map((cutoff) => (
            <SelectItem key={cutoff} value={String(cutoff)}>&ge;{cutoff}% one taxon</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={rank} onValueChange={(v) => setRank(v as TaxonomyRank)}>
        <SelectTrigger className="w-full sm:w-[150px]" aria-label="Taxonomic rank">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TAXONOMY_RANKS.map((r) => (
            <SelectItem key={r} value={r}>{RANK_LABEL[r]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  // At the 0.7 resolution the table falls back to PostgreSQL, which the browse index cannot match.
  if (unsupported) return null;
  if (!isLoading && !error && data && data.rows.length === 0) return null;

  if (isLoading || !data) {
    return <TaxonomyCompositionPlaceholder controls={controls} failed={Boolean(error)} />;
  }

  // Labels come from the payload, not the pending selection, which differs while a change is in flight.
  const {
    rank: shownRank, purity: shownPurity, rows, categories,
    totalGcfs, shownGcfs, noDominantGcfs, unresolvedGcfs, distinctTaxa, maxShare,
  } = data;
  const listed = rows.filter((r) => r.kind === 'taxon').length;
  const coverage = totalGcfs > 0 ? (shownGcfs / totalGcfs) * 100 : 0;
  const noDominantPct = totalGcfs > 0 ? (noDominantGcfs / totalGcfs) * 100 : 0;
  const unresolvedPct = totalGcfs > 0 ? (unresolvedGcfs / totalGcfs) * 100 : 0;

  return (
    <TaxonomyCompositionView
      shownRank={shownRank}
      rows={rows}
      categories={categories}
      maxShare={maxShare}
      entityNoun={NOUN}
      controls={controls}
      refreshing={refreshing}
      coverage={
        <>
          <div>
            Top {listed.toLocaleString()} of {distinctTaxa.toLocaleString()} {RANK_PLURAL[shownRank]}
            {' · '}{coverage.toFixed(1)}% of {totalGcfs.toLocaleString()} families
            {filtered ? ' matching your filters' : ''}
            {noDominantGcfs > 0 && (
              <>
                {' · '}{noDominantPct.toFixed(1)}% with no {shownRank} above {shownPurity}%
                <InfoTooltip content={`A family is filed under a taxon only when that taxon holds at least ${shownPurity}% of its members. These families span several ${RANK_PLURAL[shownRank]} with no majority — they are counted, not dropped.`} />
              </>
            )}
            {unresolvedGcfs > 0 && (
              <>
                {' · '}{unresolvedPct.toFixed(1)}% not resolved to {shownRank}
                <InfoTooltip content={`No member of these families is classified to ${shownRank}. That is the depth of the assignment, not an unknown organism, and it is a different thing from a family that spans several ${RANK_PLURAL[shownRank]}.`} />
              </>
            )}
          </div>
          {/* Not a title tooltip: those cannot render inside CardHeader. */}
          <div className="mt-1">
            Each cell is the share of that taxon&apos;s families that contain the class; a family can
            span several classes, so a row does not add up to 100%.
          </div>
        </>
      }
    />
  );
}
