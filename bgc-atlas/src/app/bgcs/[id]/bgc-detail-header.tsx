"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronDown, Download, ExternalLink, Loader2 } from "lucide-react";
import { apiFetch, withBase } from "@/lib/basePath";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/hooks/use-toast";
import { getProductCategoryBadgeStyle } from "@/lib/utils/chart-utils";
import type { BgcDetail } from "./bgc-detail-types";

// Opens the viewer page without waiting for extraction (a cold run takes minutes);
// that page shows extraction status and swaps to the viewer when ready.
function openInAntismash(bgc: BgcDetail) {
  if (!bgc.antismashRunId) return;
  const anchorParam = bgc.anchor ? `?anchor=${encodeURIComponent(bgc.anchor)}` : "";
  // window.open bypasses Next.js basePath.
  window.open(
    withBase(`/antismash/${bgc.antismashRunId}${anchorParam}`),
    "_blank",
    "noopener,noreferrer"
  );
}

const DOWNLOAD_FORMATS = [
  { format: "gbk", label: "GenBank (.gbk)" },
  { format: "fna", label: "Nucleotide FASTA (.fna)" },
  { format: "faa", label: "Protein FASTA (.faa)" },
] as const;

function filenameFrom(res: Response, fallback: string): string {
  const match = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

// Fetched rather than linked: the route reads the whole region first (10-30s on a
// cold run), and a plain link showed nothing meanwhile and turned errors into a
// generic "download failed". Regions are capped at 64 MB, so a Blob is fine.
function DownloadMenu({ bgcId }: { bgcId: string }) {
  const [pending, setPending] = useState<string | null>(null);

  const download = async (format: string, label: string) => {
    if (pending) return;
    setPending(format);
    try {
      const res = await apiFetch(`/api/bgcs/${bgcId}/download?format=${format}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `The server answered ${res.status}.`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res, `${bgcId}.${format}`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick, after the click has handed the URL over.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast({
        variant: "destructive",
        title: `${label} download failed`,
        description: error instanceof Error ? error.message : "Please try again later.",
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending !== null} aria-busy={pending !== null}>
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Download className="size-3.5" />
              Download
              <ChevronDown className="size-3.5" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {DOWNLOAD_FORMATS.map(({ format, label }) => (
          <DropdownMenuItem key={format} onSelect={() => download(format, label)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BgcDetailHeader({ bgc }: { bgc: BgcDetail }) {

  const handleOpenAntismash = () => {
    openInAntismash(bgc);
  };

  return (
    <header className="mb-6 border-b border-border pb-4">
      <div className="section-label mb-1.5">Biosynthetic gene cluster</div>
      <h1 className="atlas-rule mb-3 break-all font-mono text-xl font-semibold tracking-tight md:text-2xl">
        {bgc.id}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {bgc.category && (
          <Badge variant="secondary" style={getProductCategoryBadgeStyle(bgc.category)}>
            {bgc.category}
          </Badge>
        )}
        {bgc.categories.length > 1 &&
          bgc.categories.map((t) => (
            <Badge key={t} variant="secondary" style={getProductCategoryBadgeStyle(t)}>
              {t}
            </Badge>
          ))}
        <Badge variant={bgc.completeness === "complete" ? "solid" : "outline"}>
          {bgc.completeness}
        </Badge>
        {bgc.assemblySourceType && (
          <Badge variant="outline">{bgc.assemblySourceType}</Badge>
        )}
      </div>
      {bgc.name && (
        <p className="mt-3 max-w-3xl break-all font-mono text-[12.5px] text-muted-foreground">
          {bgc.name}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href="/bgcs">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-3.5" />
            Back to BGCs
          </Button>
        </Link>
        {bgc.antismashRunId && <DownloadMenu bgcId={bgc.id} />}
        {bgc.antismashRunId && (
          <Button
            onClick={handleOpenAntismash}
            className="bg-[#a01919] text-white shadow-sm hover:bg-[#7d1414]"
          >
            <span className="flex size-5 items-center justify-center rounded bg-white p-0.5">
              <Image
                src={withBase("/images/antismash_logo.svg")}
                alt=""
                width={16}
                height={16}
                className="h-4 w-auto"
              />
            </span>
            Open in antiSMASH
            <ExternalLink className="size-3.5" />
          </Button>
        )}
        {bgc.gcf && (
          <Link href={`/gcfs/${bgc.gcf}`}>
            <Button variant="outline" size="sm">
              View gene cluster family
            </Button>
          </Link>
        )}
        <CopyLinkButton className="ml-auto" />
      </div>
    </header>
  );
}
