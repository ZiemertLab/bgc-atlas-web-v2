import { buildCacheKey } from '@/lib/cache';

// Every parameter keeps all its values (sorted, deduped); a last-value-wins key once served a
// three-type result to a SAG-only request. v2 because the key shape changed.
export function samplesMapCacheKey(params: URLSearchParams): string {
  const inputs: Record<string, string[]> = {};
  for (const name of new Set(params.keys())) {
    inputs[name] = [...new Set(params.getAll(name))].sort();
  }
  return buildCacheKey('map:samples', 2, inputs);
}
