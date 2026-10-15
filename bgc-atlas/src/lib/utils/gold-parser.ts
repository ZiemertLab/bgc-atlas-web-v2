import type { GOLDParsed, GOLDLevel, GOLDMetadata } from '@/lib/types/gold-types';
import { ECOSYSTEM_PALETTE, ecosystemBadge, toEcosystemKey } from './ecosystem-palette';

export function parseGOLDPath(
  path: string | null | undefined,
  metadata?: GOLDMetadata | Record<string, unknown> | null
): GOLDParsed | null {
  if (!path || typeof path !== 'string') return null;

  const trimmed = path.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const levels: GOLDLevel[] = parts.map((name, index) => ({
    index,
    name,
  }));

  return {
    raw: path,
    levels,
    depth: parts.length,
    topLevel: parts[0],
    fullPath: parts,
    metadata: metadata as GOLDMetadata | undefined,
  };
}

// `level` is 0-indexed (0 = top level).
export function getGOLDLevel(
  path: string | null | undefined,
  level: number
): string | null {
  const parsed = parseGOLDPath(path);
  if (!parsed || level < 0 || level >= parsed.depth) return null;
  return parsed.fullPath[level];
}

export function formatGOLDBreadcrumb(
  path: string | null | undefined,
  separator = ' › '
): string {
  const parsed = parseGOLDPath(path);
  if (!parsed) return '';
  return parsed.fullPath.join(separator);
}

export function getGOLDColor(
  path: string | null | undefined
): string {
  return ecosystemBadge(toEcosystemKey(getGOLDLevel(path, 0)));
}

export const GOLD_LEVEL1_COLOR_HEX: Record<string, string> = {
  environmental: ECOSYSTEM_PALETTE.environmental.hex,
  'host-associated': ECOSYSTEM_PALETTE['host-associated'].hex,
  engineered: ECOSYSTEM_PALETTE.engineered.hex,
  mixed: ECOSYSTEM_PALETTE.mixed.hex,
};

export const GOLD_UNKNOWN_COLOR_HEX = ECOSYSTEM_PALETTE.unknown.hex;

export function getGOLDColorHex(path: string | null | undefined): string {
  return ECOSYSTEM_PALETTE[toEcosystemKey(getGOLDLevel(path, 0))].hex;
}

// Host-associated:Plants; kept distinct from the Environmental green (#009E73), colorblind-checked.
export const GOLD_PLANTS_COLOR_HEX = '#2E7D32';

export function isGoldPlantsPath(path: string | null | undefined): boolean {
  return (
    getGOLDLevel(path, 0)?.toLowerCase() === 'host-associated' &&
    getGOLDLevel(path, 1)?.toLowerCase() === 'plants'
  );
}

/**
 * Okabe-Ito blue for the GOLD "Environmental:Aquatic" subtree, so water reads
 * apart from soil and other terrestrial ecosystems, which keep the
 * Environmental green.
 */
export const GOLD_AQUATIC_COLOR_HEX = '#0072B2';

/** True when a GOLD path is within the Environmental:Aquatic subtree. */
export function isGoldAquaticPath(path: string | null | undefined): boolean {
  return (
    getGOLDLevel(path, 0)?.toLowerCase() === 'environmental' &&
    getGOLDLevel(path, 1)?.toLowerCase() === 'aquatic'
  );
}

// Literal string so Tailwind's content scanner emits these classes.
export const GOLD_PLANTS_BADGE_CLASS = 'bg-green-100 text-green-800 border-green-200';

/** Badge classes for the Environmental:Aquatic subtree (literal for Tailwind). */
export const GOLD_AQUATIC_BADGE_CLASS = 'bg-blue-100 text-blue-800 border-blue-200';

/**
 * Level-2 subtrees coloured apart from their top-level ecosystem. Everything
 * else is keyed on the top level (getGOLDColorHex / getGOLDColor).
 */
const GOLD_SUBTREES = [
  { test: isGoldPlantsPath, hex: GOLD_PLANTS_COLOR_HEX, badge: GOLD_PLANTS_BADGE_CLASS },
  { test: isGoldAquaticPath, hex: GOLD_AQUATIC_COLOR_HEX, badge: GOLD_AQUATIC_BADGE_CLASS },
];

/** The subtree colour for a GOLD path, or null when its top level decides. */
export function getGoldSubtreeColorHex(path: string | null | undefined): string | null {
  return GOLD_SUBTREES.find((t) => t.test(path))?.hex ?? null;
}

/**
 * Chart fill color for a GOLD path: its top-level ecosystem's colour, except
 * the Host-associated:Plants (green) and Environmental:Aquatic (blue) subtrees.
 */
export function getEcosystemChartColorHex(path: string | null | undefined): string {
  return getGoldSubtreeColorHex(path) ?? getGOLDColorHex(path);
}

/** Badge classes for a GOLD path, with the same subtree exceptions. */
export function getGOLDBadgeClass(path: string | null | undefined): string {
  return GOLD_SUBTREES.find((t) => t.test(path))?.badge ?? getGOLDColor(path);
}

export function getGOLDHierarchyUpTo(
  path: string | null | undefined,
  maxDepth: number
): string[] {
  const parsed = parseGOLDPath(path);
  if (!parsed) return [];
  return parsed.fullPath.slice(0, Math.min(maxDepth, parsed.depth));
}

// `level` is 0-indexed and inclusive: level 1 of "A:B:C" is "A:B".
export function getGOLDPathUpTo(
  path: string | null | undefined,
  level: number
): string | null {
  const parsed = parseGOLDPath(path);
  if (!parsed || level < 0) return null;
  const parts = parsed.fullPath.slice(0, level + 1);
  return parts.length > 0 ? parts.join(':') : null;
}

export function matchesGOLDPrefix(
  path: string | null | undefined,
  prefix: string | null | undefined
): boolean {
  if (!path || !prefix) return false;
  const normalizedPath = path.toLowerCase();
  const normalizedPrefix = prefix.toLowerCase();
  return normalizedPath.startsWith(normalizedPrefix);
}

/** The full GOLD path for a tooltip: "Environmental › Aquatic › Marine". */
export function goldPathTitle(path: string): string {
  return path.split(':').map((p) => p.trim()).filter(Boolean).join(' › ');
}

/**
 * Bar labels for a set of GOLD paths: the last two levels each ("Aquatic ›
 * Marine"), since the first level is already carried by the bar's colour and a
 * full level-5 path does not fit beside a bar. Where two would read the same --
 * at level 5 "Large intestine › Fecal" is the human, the mammal and the pig gut
 * -- the level that tells them apart is put in front: "Human › … › Large
 * intestine › Fecal". The full path goes in the tooltip (goldPathTitle).
 */
export function goldBarLabels(paths: string[]): Map<string, string> {
  const segsOf = (p: string) => p.split(':').map((s) => s.trim()).filter(Boolean);
  const tail = (segs: string[]) => segs.slice(-2).join(' › ');
  const groups = new Map<string, string[]>();
  for (const p of paths) groups.set(tail(segsOf(p)), [...(groups.get(tail(segsOf(p))) ?? []), p]);

  const labels = new Map<string, string>();
  for (const [shared, group] of groups) {
    if (group.length === 1) {
      labels.set(group[0], shared);
      continue;
    }
    for (const p of group) {
      const segs = segsOf(p);
      // Walk up from the shared two, keeping each level that tells this path
      // apart from a member it still reads the same as, until none remain.
      let alike = group.filter((q) => q !== p).map(segsOf);
      const picked: number[] = [];
      for (let i = segs.length - 3; i >= 0 && alike.length > 0; i--) {
        if (alike.some((o) => o[i] !== segs[i])) {
          picked.unshift(i);
          alike = alike.filter((o) => o[i] === segs[i]);
        }
      }
      let label = '';
      let prev = -1;
      for (const i of picked) {
        label += (prev === -1 ? '' : i === prev + 1 ? ' › ' : ' › … › ') + segs[i];
        prev = i;
      }
      const gap = prev === segs.length - 3 ? ' › ' : ' › … › ';
      labels.set(p, picked.length ? `${label}${gap}${shared}` : segs.join(' › '));
    }
  }
  return labels;
}
