"use client";

import { ECOSYSTEM_COLORS } from "@/lib/utils/chart-utils";
import { GOLD_AQUATIC_COLOR_HEX } from "@/lib/utils/gold-parser";

interface EcosystemLegendProps {
  /** The distribution level shown; omit where the legend explains badges. */
  level?: number;
}

export function EcosystemLegend({ level }: EcosystemLegendProps) {
  // Every level is coloured by branch (getEcosystemColor), so the level-1 keys
  // explain a level-3 bar too.
  // Aquatic is coloured apart only below level 1 (level 1 has no aquatic key),
  // so a level-1 bar never shows it.
  const showAquatic = level !== 1;
  const level1Items = [
    { label: "Environmental", color: ECOSYSTEM_COLORS['Environmental'] },
    ...(showAquatic ? [{ label: "Environmental: Aquatic", color: GOLD_AQUATIC_COLOR_HEX }] : []),
    { label: "Host-associated", color: ECOSYSTEM_COLORS['Host-associated'] },
    { label: "Host-assoc.: Plants", color: ECOSYSTEM_COLORS['Host-assoc.: Plants'] },
    { label: "Engineered", color: ECOSYSTEM_COLORS['Engineered'] },
    { label: "Mixed", color: ECOSYSTEM_COLORS['Mixed'] },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
      aria-label="GOLD ecosystem legend"
    >
      <span className="section-label mr-1">Ecosystem</span>
      {level1Items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-1.5"
          title={`${item.label} ecosystem`}
        >
          <span
            className="size-2.5 border border-border"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </div>
      ))}
      {level !== undefined && level > 1 && <span className="ml-1">(coloured by the branch each belongs to)</span>}
    </div>
  );
}
