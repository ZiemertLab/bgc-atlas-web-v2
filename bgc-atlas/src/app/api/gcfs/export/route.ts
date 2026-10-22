import { handleExport, type ExportSpec } from '@/lib/export/stream';
import { countBrowseExport, openBrowseExport } from '@/lib/export/browse-export';
import { browseExportRefusal } from '@/lib/export/browse-refusal';
import { gcfTableExportColumns } from '@/lib/export/gcf-columns';
import { deserializeFilterGroup } from '@/lib/filters/types';
import { mapGcfBrowseDocument } from '@/lib/opensearch/gcf-browse-mapper';
import { withKnownClusterRollup } from '@/lib/opensearch/known-cluster-decorations';
import type { GcfListItem } from '@/lib/hooks/use-gcfs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gcfs/export?<the /api/gcfs query>&format=csv|tsv|json[&check=1]
 * Under share filters it adds the "Matched" columns the table shows
 * (gcfTableExportColumns). See lib/export/stream.ts.
 */
const specFor = (request: Request): ExportSpec<GcfListItem> => ({
  stem: 'gcfs',
  // An unreadable advancedFilters is refused by the query itself; here it just
  // adds no columns.
  columns: gcfTableExportColumns(
    deserializeFilterGroup(new URL(request.url).searchParams.get('advancedFilters')),
  ),
  refusal: (params) => browseExportRefusal('gcfs', params),
  count: (params) => countBrowseExport('gcfs', params),
  open: (params, cap) => openBrowseExport('gcfs', params, cap, async (docs) =>
    withKnownClusterRollup(docs.map(mapGcfBrowseDocument), { strict: true }) as Promise<GcfListItem[]>),
});

export function GET(request: Request) {
  return handleExport(request, specFor(request));
}
