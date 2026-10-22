import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildStudyWhere, countStudies, countUnlistedStudies } from '@/lib/api/studies-query';

/**
 * The corpus totals that machine-readable text states: /llms.txt, /llms-full.txt,
 * /openapi.json and the site's share image.
 *
 * They were written into that text by hand, and every cohort load since moved the
 * real numbers away from them: 15,985,022 BGCs and 614,215 families were still
 * published at 16,109,198 and 629,872. Each total is read the way the page that
 * shows it reads it, so the text and the site agree: BGCs and samples as
 * /api/statistics sums them, families as /gcfs lists them, studies as the /studies
 * headline counts them (umbrella projects included).
 *
 * Server-only. The callers revalidate hourly, and these are five small aggregates.
 */
export interface CorpusFigures {
  bgcs: number;
  families: number;
  samples: number;
  studies: number;
  dataSources: number;
}

export async function getCorpusFigures(): Promise<CorpusFigures> {
  const params = new URLSearchParams();
  const [[row], listedStudies, unlistedStudies] = await Promise.all([
    prisma.$queryRaw<{ bgcs: bigint; families: bigint; samples: bigint; data_sources: bigint }[]>(Prisma.sql`
      SELECT
        (SELECT COALESCE(SUM(bgc_count), 0) FROM source_type_statistics)::bigint      AS bgcs,
        (SELECT COUNT(*) FROM gcfs WHERE listed)::bigint                             AS families,
        (SELECT COALESCE(SUM(sample_count), 0) FROM sample_source_type_counts)::bigint AS samples,
        (SELECT COUNT(*) FROM data_sources)::bigint                                  AS data_sources
    `),
    countStudies(buildStudyWhere(params)),
    countUnlistedStudies(params),
  ]);
  return {
    bgcs: Number(row.bgcs),
    families: Number(row.families),
    samples: Number(row.samples),
    studies: listedStudies + (unlistedStudies ?? 0),
    dataSources: Number(row.data_sources),
  };
}

const TOKEN = /\{(bgcs|families|samples|studies|dataSources)\}/g;

/** "{families} families" -> "629,872 families". Only the five names above are tokens. */
export function fillFigures(text: string, figures: CorpusFigures): string {
  return text.replace(TOKEN, (_, name: keyof CorpusFigures) => figures[name].toLocaleString('en-US'));
}

/** fillFigures over every string in a JSON-like value, e.g. the API catalog. */
export function fillFiguresDeep<T>(value: T, figures: CorpusFigures): T {
  if (typeof value === 'string') return fillFigures(value, figures) as T;
  if (Array.isArray(value)) return value.map((v) => fillFiguresDeep(v, figures)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillFiguresDeep(v, figures)]),
    ) as T;
  }
  return value;
}

/** 16,109,198 -> "16.1 million". */
export function millions(n: number): string {
  return `${(n / 1e6).toFixed(1)} million`;
}
