/**
 * `?familyClass=seed|fragmented`, the two clustering-v3 tiers (`gcfs.family_class`).
 * One parser for both backends; an unknown value is refused (400) rather than
 * ignored, which would list every family under a URL that names one tier.
 */
export const FAMILY_CLASSES = ['seed', 'fragmented'] as const;
export type FamilyClass = (typeof FAMILY_CLASSES)[number];

export const FAMILY_CLASS_LABELS: Record<FamilyClass, string> = {
  seed: 'Seed',
  fragmented: 'Fragmented',
};

export class FamilyClassFilterError extends Error {
  readonly rejected: string[];

  constructor(value: string) {
    super(`Unknown familyClass "${value}"; expected one of: ${FAMILY_CLASSES.join(', ')}`);
    this.name = 'FamilyClassFilterError';
    this.rejected = [value];
  }
}

export const isFamilyClass = (value: string): value is FamilyClass =>
  (FAMILY_CLASSES as readonly string[]).includes(value);

export function parseFamilyClass(params: URLSearchParams): FamilyClass | null {
  const raw = params.get('familyClass')?.trim().toLowerCase();
  if (!raw) return null;
  if (!isFamilyClass(raw)) throw new FamilyClassFilterError(raw);
  return raw;
}
