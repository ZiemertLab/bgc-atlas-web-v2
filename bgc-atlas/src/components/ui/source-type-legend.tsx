"use client";

import { SOURCE_TYPE_COLORS, SOURCE_TYPE_LABELS } from "@/lib/utils/chart-utils";

/**
 * Names the colours of a dataset-type (assembly source_type) bar. Same markup as
 * ProductCategoryLegend and EcosystemLegend, which sit beside it on /studies.
 */
export function SourceTypeLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
      aria-label="Assembly type legend"
    >
      <span className="section-label mr-1">Assembly type</span>
      {Object.entries(SOURCE_TYPE_LABELS).map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span
            className="size-2.5 border border-border"
            style={{ backgroundColor: SOURCE_TYPE_COLORS[key] }}
            aria-hidden="true"
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
