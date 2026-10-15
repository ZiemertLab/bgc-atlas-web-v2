/**
 * Sample external_ids are stored as "<source>|<id>" (e.g. "metalog|SAMN123"); bare ids are
 * unchanged and only the first segment is removed. Sample values only: assembly
 * external_ids are not prefixed.
 */
export function stripSourcePrefix<T extends string | null | undefined>(value: T): T {
  return (typeof value === 'string' ? value.replace(/^[^|]*\|/, '') : value) as T;
}

export function stripSourcePrefixes(values: readonly string[] | null | undefined): string[] {
  return Array.isArray(values) ? values.map((v) => stripSourcePrefix(v)) : [];
}
