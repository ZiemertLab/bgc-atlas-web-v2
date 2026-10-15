"use client";

import type { BgcDetail } from "./bgc-detail-types";

export function BgcDetailTaxonomy({ bgc }: { bgc: BgcDetail }) {
  const taxonomy = [
    { rank: "domain", value: bgc.taxonomyDomain },
    { rank: "phylum", value: bgc.taxonomyPhylum },
    { rank: "class", value: bgc.taxonomyClass },
    { rank: "order", value: bgc.taxonomyOrder },
    { rank: "family", value: bgc.taxonomyFamily },
    { rank: "genus", value: bgc.taxonomyGenus },
    { rank: "species", value: bgc.taxonomySpecies },
  ];

  const hasAny = taxonomy.some((t) => Boolean(t.value));
  if (!hasAny) return null;

  return (
    <section className="mb-6">
      <div className="section-label mb-2.5">Taxonomy (GTDB)</div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
        {taxonomy.map(({ rank, value }) =>
          value ? (
            <div key={rank} className="contents">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground tabular-nums">
                {rank}
              </dt>
              <dd
                className={`font-mono text-[13px] ${
                  rank === "genus" || rank === "species" ? "italic" : ""
                } text-foreground`}
              >
                {value}
              </dd>
            </div>
          ) : null
        )}
        {bgc.gtdbLineage && (
          <div className="contents">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              lineage
            </dt>
            <dd className="font-mono text-[12px] text-muted-foreground break-all">
              {bgc.gtdbLineage}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
