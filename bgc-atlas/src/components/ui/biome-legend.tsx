"use client";

import { Badge } from "@/components/ui/badge";
import { getEnvironmentColor } from "@/lib/utils/metadata-parser";

export function BiomeLegend() {
  const items: { label: string; value: string }[] = [
    { label: "Host-associated", value: "Host-associated" },
    { label: "Environmental", value: "Environmental" },
    { label: "Engineered", value: "Engineered" },
    { label: "Mixed", value: "Mixed" },
    { label: "Unknown", value: "Unknown" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" aria-label="Biome legend">
      <span className="mr-1">Biome Types:</span>
      {items.map((it) => (
        <Badge
          key={it.label}
          variant="secondary"
          className={`px-2 py-0.5 h-auto ${getEnvironmentColor(it.value)}`}
          title={`${it.label} biomes`}
        >
          {it.label}
        </Badge>
      ))}
    </div>
  );
}
