"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from "@/lib/utils/gold-parser";
import { sampleBrowseHref, sampleBrowseLabel } from "@/lib/utils/sample-link";
import type { BgcDetail } from "./bgc-detail-types";

export function BgcDetailOrigin({ bgc }: { bgc: BgcDetail }) {
  return (
    <section className="mb-6">
      <div className="section-label mb-2.5">Sample of origin</div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Assembly</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-foreground break-all">
            {bgc.assembly}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Source type</dt>
          <dd className="mt-0.5 text-foreground">
            {bgc.assemblySourceType ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Biome</dt>
          <dd className="mt-0.5 text-foreground">{bgc.biome}</dd>
        </div>
        {bgc.goldEcosystemPath && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">GOLD ecosystem</dt>
            <dd className="mt-1">
              <Badge
                variant="secondary"
                className={`h-auto max-w-full whitespace-normal px-2 py-0.5 text-xs ${getGOLDBadgeClass(bgc.goldEcosystemPath)}`}
                title={bgc.goldEcosystemPath}
              >
                {formatGOLDBreadcrumb(bgc.goldEcosystemPath)}
              </Badge>
            </dd>
          </div>
        )}
        {bgc.sampleIds.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              Sample{bgc.sampleIds.length > 1 ? "s" : ""}
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-2">
              {bgc.sampleIds.map((id, i) => (
                <Button
                  key={id}
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-8 max-w-full gap-1.5 px-2.5 font-mono text-sm"
                >
                  <Link
                    href={sampleBrowseHref(id, bgc.assemblySourceType)}
                    title={`Open ${sampleBrowseLabel(bgc.assemblySourceType)} filtered to ${bgc.sampleLabels[i] || id}`}
                  >
                    <span className="truncate">{bgc.sampleLabels[i] || id}</span>
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
