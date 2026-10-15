"use client";

import dynamic from "next/dynamic";

export const BgcRegionViewer = dynamic(
  () => import("./bgc-region-viewer.client").then((m) => ({ default: m.BgcRegionViewer })),
  {
    ssr: false,
    loading: () => (
      <section className="border border-border bg-card">
        <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          Loading viewer…
        </div>
      </section>
    ),
  }
);
