"use client";

import { PRODUCT_CATEGORY_COLORS } from "@/lib/utils/chart-utils";

// `showCombinations` adds the hatch ProductCategoryChart draws for an exact set of categories;
// only where such shares are drawn (the /gcfs family bars).
export function ProductCategoryLegend({ showCombinations = false }: { showCombinations?: boolean } = {}) {
  const items = [
    { label: "Terpene", color: PRODUCT_CATEGORY_COLORS['Terpene'] },
    { label: "RiPP", color: PRODUCT_CATEGORY_COLORS['RiPP'] },
    { label: "NRPS", color: PRODUCT_CATEGORY_COLORS['NRPS'] },
    { label: "PKS", color: PRODUCT_CATEGORY_COLORS['PKS'] },
    { label: "Saccharide", color: PRODUCT_CATEGORY_COLORS['Saccharide'] },
    { label: "Other", color: PRODUCT_CATEGORY_COLORS['Other'] },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
      aria-label="Category legend"
    >
      <span className="section-label mr-1">Category</span>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-1.5"
          title={`${item.label} category`}
        >
          <span
            className="size-2.5 border border-border"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </div>
      ))}
      {showCombinations && (
        <div
          className="flex items-center gap-1.5"
          title="Members carrying exactly this set of categories, drawn in the categories' own colours"
        >
          <span
            className="size-2.5 border border-border"
            style={{
              backgroundImage: `repeating-linear-gradient(45deg, ${PRODUCT_CATEGORY_COLORS['NRPS']} 0 3px, ${PRODUCT_CATEGORY_COLORS['PKS']} 3px 6px)`,
            }}
            aria-hidden="true"
          />
          <span>Combination, e.g. NRPS+PKS</span>
        </div>
      )}
    </div>
  );
}
