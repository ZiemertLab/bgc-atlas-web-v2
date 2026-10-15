"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Only a functional first-party cookie is set, so this is a notice, not a consent choice.
// The legacy "all" value is still accepted so earlier visitors are not asked again.

const CONSENT_COOKIE = "cookie_consent";
const CONSENT_MAX_AGE_DAYS = 180;

type ConsentValue = "necessary" | "all";

function readConsent(): ConsentValue | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(CONSENT_COOKIE + "="));
    if (!match) return null;
    const value = match.split("=")[1];
    if (value === "necessary" || value === "all") return value;
    return null;
  } catch {
    return null;
  }
}

function writeConsent(value: ConsentValue) {
  if (typeof document === "undefined") return;
  const expires = new Date();
  expires.setTime(
    expires.getTime() + CONSENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  );
  document.cookie = `${CONSENT_COOKIE}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const current = readConsent();
    setVisible(current === null);
  }, []);

  const handleConsent = (value: ConsentValue) => {
    writeConsent(value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[1000]">
      <div className="mx-auto w-full max-w-[2100px] px-4 lg:px-8 xl:px-12 2xl:px-16 pb-3">
        <div className="rounded-sm border border-border bg-card/95 supports-[backdrop-filter]:bg-card/85 supports-[backdrop-filter]:backdrop-blur-sm p-3 md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <p className="flex-1 text-sm text-muted-foreground">
              We use a strictly functional, first‑party cookie to remember your
              recent search sessions. We do not use analytics or advertising
              cookies. See our{' '}
              <Link
                className="text-brand underline underline-offset-4 decoration-brand/40 hover:decoration-brand"
                href="/privacy"
              >
                Privacy Policy
              </Link>{' '}
              for details.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => handleConsent("necessary")}
                aria-label="Dismiss cookie notice"
              >
                Got it
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
