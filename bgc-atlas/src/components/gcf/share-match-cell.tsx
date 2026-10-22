'use client';

import { Fragment } from 'react';
import type { GcfListItem } from '@/lib/hooks/use-gcfs';
import type { ShareQuery } from '@/lib/filters/share-fields';
import {
  shareConditionLabel,
  shareMatchBlankReason,
  shareMatchFor,
  shortShareDenominator,
  type ShareMatch,
} from '@/lib/gcf/share-display';

/** Every entry spelled out, and the resolved share: the cell's title. */
const fullText = (match: ShareMatch) =>
  [
    ...match.entries.map((e) => `${e.value}: ${e.text} % ${match.denominator}`),
    match.resolvedNote,
  ].filter(Boolean).join('\n');

function Blank({ title }: { title: string }) {
  return <span className="text-xs text-muted-foreground" title={title || undefined}>—</span>;
}

/**
 * Why a family matched one share condition: "Marine: 34.6 % of members with an
 * L3 ecosystem". The figures are the row's own stored shares; see
 * lib/gcf/share-display.ts for what is shown when the row matched otherwise.
 *
 * `inline` drops the truncation and writes the resolved share out, for the
 * card layout, where a title never shows.
 */
export function ShareMatchCell({
  gcf, query, inline = false,
}: { gcf: GcfListItem; query: ShareQuery; inline?: boolean }) {
  const match = shareMatchFor(gcf, query);
  if (match.status !== 'matched') return <Blank title={shareMatchBlankReason(match, query)} />;
  return (
    <span className={inline ? 'block text-xs' : 'block truncate text-xs'} title={fullText(match)}>
      {match.entries.map((entry, i) => (
        <Fragment key={entry.value}>
          {i > 0 && '; '}
          {entry.value}:{' '}
          <span className="font-mono tabular-nums">{entry.text} %</span>
        </Fragment>
      ))}
      <span className="text-muted-foreground"> {match.denominator}</span>
      {inline && match.resolvedNote && (
        <span className="block text-muted-foreground">{match.resolvedNote}</span>
      )}
    </span>
  );
}

/**
 * Past two share conditions, one column for all of them, so the default set
 * keeps its width: each matched condition as "Marine 34.6 % of members with
 * L3" -- the per-condition cell's wording, shortened; the title spells it out.
 */
export function CombinedShareMatchCell({ gcf, queries }: { gcf: GcfListItem; queries: ShareQuery[] }) {
  const matched = queries
    .map((query) => ({ query, match: shareMatchFor(gcf, query) }))
    .filter(({ match }) => match.status === 'matched');
  if (!matched.length) {
    return <Blank title="Member shares are not available for the conditions this family met." />;
  }
  const title = matched
    .map(({ query, match }) => `${shareConditionLabel(query)}\n${fullText(match)}`)
    .join('\n\n');
  return (
    <span className="block truncate text-xs" title={title}>
      {matched.map(({ query, match }, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground"> · </span>}
          {match.entries.map((entry, j) => (
            <Fragment key={entry.value}>
              {j > 0 && ', '}
              {entry.value}{' '}
              <span className="font-mono tabular-nums">{entry.text} %</span>
            </Fragment>
          ))}
          <span className="text-muted-foreground"> {shortShareDenominator(query)}</span>
        </Fragment>
      ))}
    </span>
  );
}
