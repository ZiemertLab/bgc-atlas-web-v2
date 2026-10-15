"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { apiFetch } from "@/lib/basePath";
import { MainLayout } from "@/components/layout/main-layout";
import { BgcRegionViewer } from "@/components/charts/bgc-viewer/bgc-region-viewer";
import { BgcDetailHeader } from "./bgc-detail-header";
import { BgcDetailError, BgcDetailLoading } from "./bgc-detail-states";
import { BgcDetailSummary } from "./bgc-detail-summary";
import { BgcDetailOrigin } from "./bgc-detail-origin";
import { BgcDetailTaxonomy } from "./bgc-detail-taxonomy";
import type { BgcDetail } from "./bgc-detail-types";

export default function BgcDetailPage() {
  const params = useParams();
  const bgcId = String(params?.id ?? "");

  const [bgc, setBgc] = useState<BgcDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: a missing BGC gets the 404, a failed request the retry state.
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMissing(false);

    apiFetch(`/api/bgcs/${bgcId}`)
      .then(async (res) => {
        if (res.status === 404) {
          return { notFound: true } as const;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((payload) => {
        if (cancelled) return;
        if (payload?.notFound) {
          setMissing(true);
        } else if (payload?.success && payload.data) {
          setBgc(payload.data as BgcDetail);
        } else {
          setError(payload?.error || "Unable to load BGC");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load BGC");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bgcId]);

  if (loading) return <BgcDetailLoading />;
  if (missing) notFound();
  if (error || !bgc) return <BgcDetailError error={error} />;



  return (
    <MainLayout>
      <div className="py-6">
        <div className="mx-auto w-full max-w-[1400px]">
          <BgcDetailHeader bgc={bgc} />
          <BgcDetailSummary bgc={bgc} />
        </div>

        <section className="mb-6 w-full">
          <div className="section-label mb-2.5">Cluster viewer</div>
          <BgcRegionViewer bgcId={bgc.id} />
        </section>

        <div className="mx-auto w-full max-w-[1400px]">
          <BgcDetailOrigin bgc={bgc} />
          <BgcDetailTaxonomy bgc={bgc} />
        </div>
      </div>
    </MainLayout>
  );
}
