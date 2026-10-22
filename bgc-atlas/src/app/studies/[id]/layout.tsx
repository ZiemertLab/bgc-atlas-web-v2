import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { JsonLd } from '@/components/seo/json-ld';
import { withShare } from '@/components/seo/share-metadata';
import { entityDataset } from '@/lib/structured-data';
import { canShowAbstract } from '@/lib/abstract-license';
import {
  isValidUuid,
  loadStudy,
  studyName,
  studySummary,
  studyShareDescription,
} from '@/lib/entity-loaders';

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
  const alternates = { canonical: `/studies/${id.toLowerCase()}` };
  if (!isValidUuid(id)) return withShare({ title: 'Study', robots: { index: false, follow: true } });

  const result = await loadStudy(id);
  if (result.status === 'missing') {
    return withShare({ title: 'Study', robots: { index: false, follow: true } });
  }
  if (result.status === 'error') return withShare({ title: 'Study', alternates });

  const { row } = result;
  return withShare(
    {
      alternates: { canonical: `/studies/${row.study_id}` },
      title: trim(studyName(row)),
      description: studySummary(row),
    },
    studyShareDescription(row),
  );
}

/**
 * /studies/<study_key> goes to the study's uuid page, as /api/studies/<study_key>
 * answers for it and /gcfs/<name> redirects. Throws (as Next's redirect does) when
 * the key matches; returns when it does not.
 */
async function redirectByKey(key: string) {
  // 1,887 keys hold a space, a slash or another character a link has to escape.
  // Both spellings are tried: the segment as Next hands it over, and decoded once.
  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    // A stray '%' that is not an escape: the key is matched as written.
  }
  let studyId: string | undefined;
  try {
    [{ study_id: studyId } = { study_id: undefined }] = await prisma.$queryRaw<{ study_id: string }[]>(Prisma.sql`
      SELECT study_id::text AS study_id FROM study_bgc_summary
      WHERE study_key IN (${key}, ${decoded})
      ORDER BY study_key = ${key} DESC
      LIMIT 1
    `);
  } catch (error) {
    // Rethrown, not swallowed: falling through would reach notFound() below and
    // answer a database blip with a 404.
    console.error(`Study key lookup failed for ${key}:`, error);
    throw error;
  }
  if (studyId) permanentRedirect(`/studies/${studyId}`);
}

export default async function Layout({ params, children }: StudyDetailLayoutProps) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    await redirectByKey(id);
  } else if (id !== id.toLowerCase()) {
    permanentRedirect(`/studies/${id.toLowerCase()}`);
  }
  const result = await loadStudy(id);
  // The client page decided "not found" after the response had started, so an
  // unknown study was a 200. Decided here, before streaming, it is a real 404 --
  // but only for 'missing': a database error must not tell crawlers a study is gone.
  if (result.status === 'missing') notFound();
  const row = result.status === 'ok' ? result.row : null;
  // A study loaded from several sources has one physical row per source (8,059
  // rows behind 99 studies), and each answered 200 with a canonical of its own.
  // The summary's study_id is the one page; the rest point at it.
  if (row && row.study_id !== id) permanentRedirect(`/studies/${row.study_id}`);

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
