import type { Metadata } from 'next';
import { JsonLd } from '@/components/seo/json-ld';
import { entityDataset } from '@/lib/structured-data';
import { canShowAbstract } from '@/lib/abstract-license';
import { isValidUuid, loadStudy, studyName, studySummary } from '@/lib/entity-loaders';

// page.tsx is a client component, so its metadata lives here.

// Study titles run past 200 characters; trim on a word boundary.
const TITLE_MAX = 70;
function trim(text: string): string {
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

interface StudyDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

// Each return sets its own canonical, or it inherits '/studies' and reads as a duplicate of the list.
// Missing studies are noindexed; a DB error is not, so one bad minute cannot deindex real pages.
export async function generateMetadata({ params }: StudyDetailLayoutProps): Promise<Metadata> {
  const { id } = await params;
  const alternates = { canonical: `/studies/${id}` };
  if (!isValidUuid(id)) return { title: 'Study', robots: { index: false, follow: true } };

  const result = await loadStudy(id);
  if (result.status === 'missing') {
    return { title: 'Study', robots: { index: false, follow: true } };
  }
  if (result.status === 'error') return { title: 'Study', alternates };

  const { row } = result;
  return {
    alternates,
    title: trim(studyName(row)),
    description: studySummary(row),
  };
}

export default async function Layout({ params, children }: StudyDetailLayoutProps) {
  const { id } = await params;
  const result = await loadStudy(id);
  const row = result.status === 'ok' ? result.row : null;

  // Same gate as the UI: an abstract without a permitting licence must not reach crawlers either.
  const showAbstract =
    !!row && !!row.abstract && canShowAbstract(row.abstract_source, row.abstract_license);
  const description = row ? (showAbstract ? row.abstract : studySummary(row)) : null;

  // Mirror the UI's credit line so the machine-readable copy keeps the attribution.
  const creditText = !showAbstract
    ? null
    : row!.abstract_source === 'mgnify'
      ? 'Study description from MGnify'
      : row!.abstract_source === 'ena'
        ? 'Study description from ENA'
        : `Abstract reproduced under ${row!.abstract_license}`;

  return (
    <>
      {row && description && (
        <JsonLd
          data={entityDataset({
            path: `/studies/${id}`,
            identifier: row.study_key,
            name: studyName(row),
            description,
            creditText,
            keywords: ['metagenomics', 'biosynthetic gene clusters', 'natural products'],
            variables: [
              { name: 'Samples', value: row.sample_count },
              { name: 'Biosynthetic gene clusters', value: row.total_bgcs },
            ],
          })}
        />
      )}
      {children}
    </>
  );
}
