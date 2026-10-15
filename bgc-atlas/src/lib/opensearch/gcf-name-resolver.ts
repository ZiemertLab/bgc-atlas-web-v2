// Resolves readable GCF names in `gcf_id` property-search filters to the UUIDs stored in
// bgc_facets, as an async pre-pass over the FilterGroup (`makeResolver` is synchronous).
import type { FilterCondition, FilterGroup, FilterValue } from '@/lib/filters/types';

const GCF_FIELD = 'gcf_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** name (or pet name) -> gcf_id UUID; absent from the map means unresolvable. */
export type GcfNameLookup = (names: string[]) => Promise<Map<string, string>>;

const values = (v: FilterValue): string[] =>
  (Array.isArray(v) ? v : [v]).map(String).filter((s) => s !== '');

export function collectGcfNames(group: FilterGroup | null): string[] {
  const out = new Set<string>();
  const walk = (g: FilterGroup) => {
    for (const c of g.conditions) {
      if (c.field !== GCF_FIELD) continue;
      for (const v of values(c.value)) if (!UUID_RE.test(v)) out.add(v);
    }
    g.groups.forEach(walk);
  };
  if (group) walk(group);
  return [...out];
}

const substitute = (c: FilterCondition, map: Map<string, string>): FilterCondition => {
  const swap = (v: string) => map.get(v) ?? v;
  return {
    ...c,
    value: Array.isArray(c.value)
      ? c.value.map((v) => swap(String(v)))
      : swap(String(c.value)),
  };
};

/**
 * Clone `group` with every resolvable gcf_id name replaced by its UUID. An unresolvable
 * name is left in place so the condition matches nothing; dropping it would widen the
 * result. Returns the original reference when there is nothing to resolve.
 */
export async function resolveGcfNames(
  group: FilterGroup | null,
  lookup: GcfNameLookup,
): Promise<FilterGroup | null> {
  const names = collectGcfNames(group);
  if (!group || !names.length) return group;

  const map = await lookup(names);
  if (!map.size) return group;

  const clone = (g: FilterGroup): FilterGroup => ({
    ...g,
    conditions: g.conditions.map((c) => (c.field === GCF_FIELD ? substitute(c, map) : c)),
    groups: g.groups.map(clone),
  });
  return clone(group);
}
