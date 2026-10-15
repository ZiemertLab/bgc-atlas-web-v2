import { handleExport, type ExportSpec } from '@/lib/export/stream';
import { countBrowseExport, openBrowseExport } from '@/lib/export/browse-export';
import { browseExportRefusal } from '@/lib/export/browse-refusal';
import { GCF_TABLE_EXPORT_COLUMNS } from '@/lib/export/gcf-columns';
import { mapGcfBrowseDocument } from '@/lib/opensearch/gcf-browse-mapper';
import { withKnownClusterRollup } from '@/lib/opensearch/known-cluster-decorations';
import type { GcfListItem } from '@/lib/hooks/use-gcfs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gcfs/export?<the /api/gcfs query>&format=csv|tsv|json[&check=1]
 * See lib/export/stream.ts.
 */
const spec: ExportSpec<GcfListItem> = {
  stem: 'gcfs',
  columns: GCF_TABLE_EXPORT_COLUMNS,
  refusal: (params) => browseExportRefusal('gcfs', params),
  count: (params) => countBrowseExport('gcfs', params),
  open: (params, cap) => openBrowseExport('gcfs', params, cap, async (docs) =>
    withKnownClusterRollup(docs.map(mapGcfBrowseDocument), { strict: true }) as Promise<GcfListItem[]>),
};

export function GET(request: Request) {
  return handleExport(request, spec);
}
