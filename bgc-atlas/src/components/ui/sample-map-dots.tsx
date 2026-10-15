"use client";

import dynamic from "next/dynamic";

export const SampleMapDots = dynamic(
  () =>
    import("./sample-map-dots.client").then((m) => ({ default: m.DotsMap })),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto flex h-[800px] w-full max-w-[1024px] items-center justify-center border border-border bg-card text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  }
);
