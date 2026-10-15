// Sort fields no index can serve: with no narrowing filter, `taxonomy` forces a 16.5M-row sort (>150 s).
export const SCAN_HEAVY_SORT_FIELDS: readonly string[] = ['taxonomy'];

export function isScanHeavySort(field: string): boolean {
  return SCAN_HEAVY_SORT_FIELDS.includes(field);
}

// Mirrors the server-side sort guard so the UI never offers a sort the API would drop.
// Empty strings/arrays, null and `all` do not count.
export function hasAnyActiveFilter(
  // `object` so typed filter-state interfaces pass without a cast.
  ...sources: Array<object | undefined | null>
): boolean {
  return sources.some((src) =>
    src
      ? Object.values(src).some((v: unknown) => {
          if (v === null || v === undefined) return false;
          if (typeof v === 'string') return v.trim() !== '' && v !== 'all';
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === 'boolean') return v;
          return true;
        })
      : false,
  );
}

export function applySortFieldGuard(
  fields: readonly string[],
  orders: readonly string[],
  hasNarrowingFilter: boolean,
): { fields: string[]; orders: string[]; dropped: string[] } {
  if (hasNarrowingFilter) {
    return { fields: [...fields], orders: [...orders], dropped: [] };
  }
  const keptF: string[] = [];
  const keptO: string[] = [];
  const dropped: string[] = [];
  fields.forEach((f, i) => {
    if (isScanHeavySort(f)) {
      dropped.push(f);
    } else {
      keptF.push(f);
      keptO.push(orders[i]);
    }
  });
  return { fields: keptF, orders: keptO, dropped };
}
