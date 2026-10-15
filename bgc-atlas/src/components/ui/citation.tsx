import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Citation {
  authors: string;
  title: string;
  // Pre-rendered: a preprint has no volume or pages.
  venue: string;
  venueItalic: string;
  doi: string;
  short: string;
}

const CITATIONS: Citation[] = [
  {
    authors: 'Caner Bağcı, Alec Talamas-Tanner, Nadine Ziemert',
    title:
      'BGC Atlas v2: biosynthetic gene clusters with taxonomic and environmental context at scale',
    venueItalic: 'bioRxiv',
    venue: '18 September 2026 · Preprint',
    doi: 'https://doi.org/10.64898/2026.09.14.751540',
    short: 'bioRxiv (2026)'
  },
  {
    authors:
      'Caner Bağcı, Matin Nuhamunada, Hemant Goyat, Casimir Ladanyi, Ludek Sehnal, Kai Blin, Satria A Kautsar, Azat Tagirdzhanov, Alexey Gurevich, Shrikant Mantri, Christian von Mering, Daniel Udwary, Marnix H Medema, Tilmann Weber, Nadine Ziemert',
    title:
      'BGC Atlas: a web resource for exploring the global chemical diversity encoded in bacterial genomes',
    venueItalic: 'Nucleic Acids Research',
    venue: 'Volume 53, Issue D1, 6 January 2025, Pages D618–D624',
    doi: 'https://doi.org/10.1093/nar/gkae953',
    short: 'Nucleic Acids Research (2025)'
  }
];

function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="border border-border bg-card px-5 py-4 text-sm leading-relaxed">
      <p className="text-foreground">{citation.authors}</p>
      <p className="mt-1 italic text-foreground">{citation.title}</p>
      <p className="mt-1 text-muted-foreground">
        <span className="italic">{citation.venueItalic}</span>, {citation.venue}
      </p>
      <p className="mt-2">
        <Link
          href={citation.doi}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[12.5px] break-words text-foreground underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground"
        >
          {citation.doi}
        </Link>
      </p>
    </div>
  );
}

interface CitationCardsProps {
  className?: string;
}

export function CitationCards({ className }: CitationCardsProps) {
  return (
    <div className={className}>
      <div className="section-label mb-1.5">Citations</div>
      <div className="space-y-3">
        {CITATIONS.map((citation) => (
          <CitationCard key={citation.doi} citation={citation} />
        ))}
      </div>
    </div>
  );
}

interface CitationBadgeProps {
  className?: string;
}

export function CitationBadge({ className }: CitationBadgeProps) {
  return (
    <div className={cn('border-l-2 border-foreground/40 pl-3 text-sm', className)}>
      <div className="section-label mb-1">Cite as</div>
      <div className="space-y-0.5">
        {CITATIONS.map((citation) => (
          <div key={citation.doi} className="text-foreground">
            Bağcı et al.,{' '}
            <Link
              href={citation.doi}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground"
            >
              {citation.short}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
