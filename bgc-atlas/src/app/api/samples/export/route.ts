import { NextResponse } from 'next/server';

import { handleExport, ExportRefusedError, type ExportSpec } from '@/lib/export/stream';
import { countBrowseExport, openBrowseExport } from '@/lib/export/browse-export';
import { browseExportRefusal } from '@/lib/export/browse-refusal';
import { GENOME_EXPORT_COLUMNS, METAGENOME_EXPORT_COLUMNS } from '@/lib/export/sample-columns';
import { goldBucketRefusal, sourceTypeRefusal } from '@/lib/api/filter-refusal';
import { hydrateSampleEnrichments } from '@/lib/api/sample-enrichments';
import { mapSampleRowToSample, type SampleRow } from '@/lib/api/samples-query';
import type { Sample } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/samples/export?<the /api/samples query>&view=metagenomes|genomes
 *     &format=csv|tsv|json[&check=1]
 *
 * `view` picks which table's columns the file mirrors; genomes also get the
 * genome table's per-batch enrichments. See lib/export/stream.ts.
 */
const isGenomes = (request: Request) => new URL(request.url).searchParams.get('view') === 'genomes';

async function preIndexRefusal(params: URLSearchParams): Promise<string | null> {
  const response = sourceTypeRefusal(params) ?? goldBucketRefusal(params);
  if (!response) return null;
  const body = await (response as NextResponse).json() as { message?: string; error?: string };
  return body.message ?? body.error ?? 'This filter cannot be exported.';
}

function specFor(genomes: boolean): ExportSpec<Sample> {
  const enrich = genomes
    ? (docs: Record<string, unknown>[]) => hydrateSampleEnrichments(
        docs, { gtdbAccession: true, taxonomy: true, studyLinks: false }, { strict: true })
    : async (docs: Record<string, unknown>[]) => docs;
  const refusedFirst = async (params: URLSearchParams) => {
    const reason = await preIndexRefusal(params);
    if (reason) throw new ExportRefusedError(reason);
  };
  return {
    stem: genomes ? 'genomes' : 'metagenomes',
    columns: genomes ? GENOME_EXPORT_COLUMNS : METAGENOME_EXPORT_COLUMNS,
    refusal: (params) => browseExportRefusal('samples', params),
    count: async (params) => {
      await refusedFirst(params);
      return countBrowseExport('samples', params);
    },
    open: async (params, cap) => {
      await refusedFirst(params);
      return openBrowseExport('samples', params, cap, async (docs) =>
        (await enrich(docs)).map((doc) => mapSampleRowToSample(doc as unknown as SampleRow) as Sample));
    },
  };
}

export function GET(request: Request) {
  return handleExport(request, specFor(isGenomes(request)));
}
