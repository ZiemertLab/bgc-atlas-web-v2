"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ColdLoadHintProps {
  loading: boolean;
  /** e.g. "Loading BGCs". */
  label: string;
  className?: string;
  /** ms before the "running query" line. */
  warmAfterMs?: number;
  /** ms before the cold-cache disclosure. */
  coldAfterMs?: number;
}

export function ColdLoadHint({
  loading,
  label,
  className,
  warmAfterMs = 1500,
  coldAfterMs = 4000,
}: ColdLoadHintProps) {
  const [phase, setPhase] = useState<"warm" | "running" | "cold">("warm");

  useEffect(() => {
    if (!loading) {
      setPhase("warm");
      return;
    }
    setPhase("warm");
    const t1 = setTimeout(() => setPhase("running"), warmAfterMs);
    const t2 = setTimeout(() => setPhase("cold"), coldAfterMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [loading, warmAfterMs, coldAfterMs]);

  if (!loading) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 border border-border bg-muted/30 px-4 py-3",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="mt-0.5 size-5 shrink-0 animate-spin text-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {label}
          {phase !== "warm" && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              · running query
            </span>
          )}
        </div>
        {phase === "cold" && (
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
            First request for this query is computing against the database —
            can take up to ~30&nbsp;seconds. Subsequent loads of the same query
            are cached and return instantly.
          </p>
        )}
      </div>
    </div>
  );
}
