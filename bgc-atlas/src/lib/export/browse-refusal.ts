// The export reads the browse index only; a query the index refuses would take the slow
// PostgreSQL path, so it is refused with the reason, never widened. Server only.
import { isBrowseSearchEnabled } from '@/lib/opensearch/browse-client';
import { supportsBrowseSearch, type BrowseEntity } from '@/lib/opensearch/browse-query';
import {
  GENERIC_SQL_EXPORT_REFUSAL,
  INDEX_UNAVAILABLE_EXPORT_REFUSAL,
  SAMPLE_TEXT_FILTER_EXPORT_REFUSAL,
} from '@/lib/export/refusal-messages';

export function browseExportRefusal(entity: BrowseEntity, params: URLSearchParams): string | null {
  if (!isBrowseSearchEnabled(entity)) return INDEX_UNAVAILABLE_EXPORT_REFUSAL;
  if (supportsBrowseSearch(entity, params)) return null;
  if (entity === 'samples' && (params.has('environmentText') || params.has('host'))) {
    return SAMPLE_TEXT_FILTER_EXPORT_REFUSAL;
  }
  return GENERIC_SQL_EXPORT_REFUSAL;
}
