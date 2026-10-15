'use client';

import Link from 'next/link';
import { memo } from 'react';

import { getGOLDColorHex } from '@/lib/utils/gold-parser';
import { getProductCategoryColor } from '@/lib/utils/chart-utils';
import type { Study } from '@/lib/types';

// Narrow-screen counterpart of the /studies ResizableTable. Categories are drawn on share of
// assignments: product_category is multi-label.
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

function StudyRowComponent({ study }: { study: Study }) {
  const title = study.title || study.study_name || study.study_key;
  const coverage = study.gcf_coverage == null ? null : Math.round(study.gcf_coverage * 100);

  const categories = Object.entries(study.product_category_dist ?? {})
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);
  const categoryTotal = categories.reduce((sum, [, n]) => sum + n, 0);

  return (
    <li className="group border-b last:border-0">
      <Link href={`/studies/${study.study_id}`} className="block py-4 outline-none">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 flex-1 text-[15px] font-medium leading-snug group-hover:text-brand group-focus-visible:text-brand">
            {title}
          </h3>
          {study.exclusive_gcfs > 0 && (
            <span className="shrink-0 font-mono text-sm tabular-nums text-brand">
              {num(study.exclusive_gcfs)}
              <span className="ml-1 text-xs text-muted-foreground">exclusive</span>
            </span>
          )}
        </div>

        {/* Separators only at sm+: with flex-wrap a ::before dot can start a wrapped line. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:gap-x-2 sm:[&>*+*]:before:mr-2 sm:[&>*+*]:before:content-['·']">
          {study.center_name && <span className="truncate">{study.center_name}</span>}
          {study.bioproject && <span className="font-mono">{study.bioproject}</span>}
          {study.gold_bucket && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: getGOLDColorHex(study.gold_bucket) }}
                aria-hidden
              />
              {study.gold_bucket}
            </span>
          )}
          <span>
            <span className="font-mono tabular-nums">{num(study.sample_count)}</span>{' '}
            {study.sample_count === 1 ? 'sample' : 'samples'}
          </span>
          {study.genome_count > 0 && (
            <span>
              <span className="font-mono tabular-nums">{num(study.genome_count)}</span>{' '}
              {study.genome_count === 1 ? 'genome' : 'genomes'}
            </span>
          )}
          <span>
            <span className="font-mono tabular-nums">{num(study.total_bgcs)}</span> BGCs
          </span>
          <span>
            <span className="font-mono tabular-nums">{num(study.complete_bgcs)}</span> complete
          </span>
          {coverage != null && <span>{coverage}% clustered</span>}
        </div>

        {categoryTotal > 0 && (
          <div
            className="mt-2 flex h-1.5 w-full max-w-[520px] overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={categories.map(([c, n]) => `${c} ${num(n)}`).join(', ')}
          >
            {categories.map(([category, count], i) => (
              <div
                key={category}
                className="h-full"
                style={{
                  width: `${(count / categoryTotal) * 100}%`,
                  background: getProductCategoryColor(category, i),
                }}
              />
            ))}
          </div>
        )}
      </Link>
    </li>
  );
}

export const StudyRow = memo(StudyRowComponent);
StudyRow.displayName = 'StudyRow';
