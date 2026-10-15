import { handleExport, type ExportSource, type ExportSpec } from '@/lib/export/stream';
import { EXPORT_BATCH } from '@/lib/export/stream';
import { STUDY_EXPORT_COLUMNS } from '@/lib/export/study-columns';
import { buildStudyOrder, buildStudyWhere, countStudies, fetchStudyRows } from '@/lib/api/studies-query';
import type { Study } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/studies/export?<the /api/studies query>&format=csv|tsv|json[&check=1]
 *
 * Uses the list route's WHERE and ORDER BY (lib/api/studies-query.ts); the order
 * ends on study_key, so LIMIT/OFFSET batches neither repeat nor skip.
 */
const spec: ExportSpec<Study> = {
  stem: 'studies',
  columns: STUDY_EXPORT_COLUMNS,
  refusal: () => null,
  count: async (params) => countStudies(buildStudyWhere(params)),
  open: async (params, cap): Promise<ExportSource<Study>> => {
    const where = buildStudyWhere(params);
    const order = buildStudyOrder(params);
    const total = await countStudies(where);
    const wanted = Math.min(total, cap);
    const fetch = async (offset: number) =>
      (await fetchStudyRows(where, order, Math.min(EXPORT_BATCH, wanted - offset), offset)) as unknown as Study[];
    const first = wanted > 0 ? await fetch(0) : [];
    async function* rest(): AsyncGenerator<Study[], void, void> {
      for (let offset = first.length; offset < wanted; offset += EXPORT_BATCH) {
        const batch = await fetch(offset);
        if (!batch.length) return;
        yield batch;
      }
    }
    return { total, first, rest: rest(), close: async () => {} };
  },
};

export function GET(request: Request) {
  return handleExport(request, spec);
}
