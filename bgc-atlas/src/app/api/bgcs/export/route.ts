import { handleExport, type ExportSpec } from '@/lib/export/stream';
import { countBrowseExport, openBrowseExport } from '@/lib/export/browse-export';
import { browseExportRefusal } from '@/lib/export/browse-refusal';
import { BGC_EXPORT_COLUMNS, type ExportableBgc } from '@/lib/export/bgc-columns';
import { mapBgcBrowseDocument } from '@/lib/opensearch/bgc-browse-mapper';
import { withKnownClusterHits } from '@/lib/opensearch/known-cluster-decorations';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bgcs/export?<the /api/bgcs query>&format=csv|tsv|json[&check=1]
 * See lib/export/stream.ts for the check-then-download flow.
 */
const spec: ExportSpec<ExportableBgc> = {
  stem: 'bgcs',
  columns: BGC_EXPORT_COLUMNS,
  refusal: (params) => browseExportRefusal('bgcs', params),
  count: (params) => countBrowseExport('bgcs', params),
  open: (params, cap) => openBrowseExport('bgcs', params, cap, async (docs) =>
    // strict: a failed lookup fails the export rather than blanking the column.
    (await withKnownClusterHits(docs.map(mapBgcBrowseDocument), { strict: true })) as unknown as ExportableBgc[]),
};

export function GET(request: Request) {
  return handleExport(request, spec);
}
