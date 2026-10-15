"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/loading-skeleton";

export function BgcDetailLoading() {
  return (
    <MainLayout>
      <div className="container max-w-[1400px] px-4 lg:px-8 py-6">
        <div className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-1.5">Biosynthetic gene cluster</div>
          <div className="h-9 w-1/2 animate-pulse rounded-sm bg-muted" />
        </div>
        <TableSkeleton rows={6} />
      </div>
    </MainLayout>
  );
}

// A failed request; a missing BGC is a 404 and gets the site-wide page instead.
export function BgcDetailError({ error }: { error: string | null }) {
  const router = useRouter();
  return (
    <MainLayout>
      <div className="container max-w-[1400px] px-4 lg:px-8 py-12 text-center">
        <h1 className="mb-2 text-base font-semibold text-destructive">
          Unable to load BGC
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          {error ?? "The request did not come back. Try again in a moment."}
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/bgcs")}>
          <ArrowLeft className="size-3.5" />
          Back to BGCs
        </Button>
      </div>
    </MainLayout>
  );
}
