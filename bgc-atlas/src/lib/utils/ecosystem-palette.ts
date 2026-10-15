// Tailwind classes are literal strings so Tailwind's content scanner picks them up.

export type EcosystemKey =
  | 'environmental'
  | 'host-associated'
  | 'engineered'
  | 'mixed'
  | 'unknown';

interface EcosystemColor {
  hex: string;
  /** Tailwind -100 equivalent. */
  lightHex: string;
  bg: string;
  text: string;
  border: string;
}

export const ECOSYSTEM_PALETTE: Record<EcosystemKey, EcosystemColor> = {
  environmental: { hex: '#009E73', lightHex: '#d1fae5', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200' },
  'host-associated': { hex: '#D55E00', lightHex: '#ffedd5', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' },
  engineered: { hex: '#CC79A7', lightHex: '#fce7f3', bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-200' },
  mixed: { hex: '#E69F00', lightHex: '#fef3c7', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
  unknown: { hex: '#9ca3af', lightHex: '#f3f4f6', bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200' },
};

export function toEcosystemKey(name: string | null | undefined): EcosystemKey {
  const k = name?.toLowerCase();
  if (k === 'environmental' || k === 'host-associated' || k === 'engineered' || k === 'mixed') {
    return k;
  }
  return 'unknown';
}

export const ecosystemBadge = (key: EcosystemKey): string => {
  const c = ECOSYSTEM_PALETTE[key];
  return `${c.bg} ${c.text} ${c.border}`;
};

export const ecosystemBadgeNoBorder = (key: EcosystemKey): string => {
  const c = ECOSYSTEM_PALETTE[key];
  return `${c.bg} ${c.text}`;
};
