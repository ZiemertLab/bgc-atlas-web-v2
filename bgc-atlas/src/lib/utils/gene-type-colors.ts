// Matches antiSMASH's `svgene-type-*` palette (bacteria.css).

export type GeneType =
  | 'biosynthetic'
  | 'biosynthetic-additional'
  | 'regulatory'
  | 'transport'
  | 'resistance'
  | 'other';

export const GENE_TYPE_COLORS: Record<GeneType, string> = {
  biosynthetic: '#810e15',
  'biosynthetic-additional': '#f16d75',
  regulatory: '#2e8b57',
  transport: '#6495ed',
  resistance: '#bbbbbb',
  other: '#808080',
} as const;

export const GENE_TYPE_LABELS: Record<GeneType, string> = {
  biosynthetic: 'Biosynthetic',
  'biosynthetic-additional': 'Additional biosynthetic',
  regulatory: 'Regulatory',
  transport: 'Transport',
  resistance: 'Resistance',
  other: 'Other',
} as const;
