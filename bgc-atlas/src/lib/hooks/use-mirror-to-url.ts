"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  classifyNavigation,
  consumeOwnWrite,
  nextUrl,
  recordOwnWrite,
  type UrlEntry,
} from "@/lib/url-state";

/**
 * The queries each mirrored route wrote itself and has not yet seen arrive,
 * oldest first, keyed by pathname so two list pages visited in one tab do not
 * read each other's writes. Module-level: it must outlive the inner page
 * component, which useExternalNavigationKey remounts.
 */
const ownWrites = new Map<string, string[]>();

/**
 * Mirror page state into the URL, so the address bar and CopyLinkButton capture
 * what is on screen rather than a bare path.
 *
 * Contract:
 * - Every URL param the page owns goes through this ONE call. A mirrored page
 *   must not call router.replace / history.replaceState itself: the two writes
 *   race, each built from a searchParams that does not yet hold the other's
 *   change, and the last one wins (on /gcfs that put cleared advanced filters
 *   back). It would also read as an external navigation (below) and re-seed.
 * - Seed state from the URL in useState initializers, and pass
 *   `enabled = false` until the page is mounted, so the first write never lays
 *   defaults over the link being opened.
 * - To drop a param, set its state to '' (or its default).
 * - The page's outer component renders the stateful inner one as
 *   `<Inner key={useExternalNavigationKey()} />`, inside its Suspense.
 *
 * replace(), not push(): typing a search would otherwise bury the previous page
 * under a dozen history entries. Defaults are omitted so a shared link stays
 * short. No write happens when the URL already matches (see nextUrl).
 *
 * External navigations: state is seeded on mount, and a same-route navigation
 * the page did not write (the nav item's bare /gcfs while on /gcfs?search=x, a
 * link to /bgcs?gcf=Y while on /bgcs?gcf=X, Back between two such entries)
 * changes searchParams without remounting. Left alone, this hook would write the
 * old state straight back over the new URL. So every write is recorded here
 * until it arrives, and useExternalNavigationKey bumps the key whenever the URL
 * changes to anything that is not one of those writes: the inner page remounts
 * and seeds from the URL exactly as a fresh visit does.
 */
export function useMirrorToUrl(entries: readonly UrlEntry[], enabled: boolean): void {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const url = enabled && pathname ? nextUrl(pathname, searchParams, entries) : null;
  useEffect(() => {
    if (!url || !pathname) return;
    // Record before replace(), so the render that delivers it already finds it.
    // StrictMode's second effect run records it twice; consuming drops both.
    const q = url.indexOf("?");
    ownWrites.set(pathname, recordOwnWrite(ownWrites.get(pathname) ?? [], q === -1 ? "" : url.slice(q + 1)));
    router.replace(url, { scroll: false });
  }, [router, url, pathname]);
}

/**
 * A key for the page's inner component that changes on every same-route
 * navigation useMirrorToUrl did not write itself. See useMirrorToUrl.
 *
 * The decision is taken during render (the setState-during-render pattern), not
 * in an effect. The inner page reads searchParams too, and effects run child
 * first: with an effect here, the old inner would render once with the new URL
 * and its mirror effect would replace() the old state over it before this one
 * could bump the key. Updating state during render makes React re-run this
 * component before rendering its children, so the old inner is unmounted
 * without ever seeing the new URL, and the new one mounts with `mounted` false,
 * which keeps its mirror off until it has seeded.
 *
 * The record is updated after commit, in an effect, so render only reads it and
 * StrictMode's double render takes the same decision both times:
 * - 'own': the arrived write and every older one are dropped.
 * - 'external' (and the first mount): the list is cleared. Otherwise Back to the
 *   old filtered URL would match a write still on it, count as 'own', and be
 *   overwritten by the state the external navigation just seeded; and a list
 *   left by an earlier visit to the route belongs to a page that is gone.
 * The new inner cannot write in the commit that clears it: its mirror is off
 * until its own mount effect has run and it has rendered again.
 */
export function useExternalNavigationKey(): number {
  const pathname = usePathname() ?? "";
  const query = useSearchParams()?.toString() ?? "";
  const [nav, setNav] = useState<{ key: number; seen: string; kind: "own" | "external" }>(() => ({
    key: 0,
    seen: query,
    kind: "external",
  }));
  // Reads mutable module state during render, on purpose: the writes it is
  // compared with happen in effects, outside React state.
  const kind = classifyNavigation(query, nav.seen, ownWrites.get(pathname) ?? []);
  if (kind === "external") setNav({ key: nav.key + 1, seen: query, kind });
  else if (kind === "own") setNav({ key: nav.key, seen: query, kind });

  useEffect(() => {
    if (nav.kind === "own") ownWrites.set(pathname, consumeOwnWrite(ownWrites.get(pathname) ?? [], nav.seen));
    else ownWrites.delete(pathname);
  }, [pathname, nav]);

  return nav.key;
}
