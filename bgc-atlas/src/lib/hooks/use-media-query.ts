'use client';

import { useEffect, useState } from 'react';

/**
 * Reads the first value synchronously, so use it only in client-only trees
 * (`dynamic(..., { ssr: false })`); under SSR it would hydrate into a layout flash.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
