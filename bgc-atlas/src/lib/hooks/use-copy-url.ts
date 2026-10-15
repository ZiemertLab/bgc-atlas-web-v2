"use client";

import { useCallback } from "react";
import { toast } from "@/lib/hooks/use-toast";

/**
 * Copies the current page URL (or `href`) to the clipboard and shows a toast.
 * Falls back to a textarea copy when the clipboard API is unavailable.
 */
export function useCopyUrl() {
  return useCallback(async (label = "Link copied", href?: string) => {
    const url =
      href ?? (typeof window !== "undefined" ? window.location.href : "");
    if (!url) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast({ title: label, description: "URL is on your clipboard." });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Couldn't write to the clipboard.",
      });
    }
  }, []);
}
