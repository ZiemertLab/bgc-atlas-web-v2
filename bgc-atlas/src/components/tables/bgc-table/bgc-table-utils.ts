import { withBase } from "@/lib/basePath";
import { useEffect, useState } from 'react';
import type { BgcListItem } from './bgc-table-types';
import { BGC_EXPORT_COLUMNS, type ExportableBgc } from '@/lib/export/bgc-columns';
import {
  downloadText, exportFilename, serializeExport, type ExportFormat,
} from '@/lib/export/format';

export function useDebouncedValue<T>(value: T, delay = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Does not trigger extraction: the viewer page reports extraction status itself.
export const antismashViewerHref = (bgc: BgcListItem): string | null => {
  if (!bgc?.antismashRunId) {
    return null;
  }
  const anchorParam = bgc.anchor ? `?anchor=${encodeURIComponent(bgc.anchor)}` : '';
  // window.open ignores the Next.js basePath, so prefix it here.
  return withBase(`/antismash/${bgc.antismashRunId}${anchorParam}`);
};

// Re-exported for existing callers; shared with the server's streamed export.
export { getExportValue, type ExportableBgc, type ExportOptions } from '@/lib/export/bgc-columns';

// Every column the table can show, so a page is an exact slice of the full-result export.
export const handleDownload = (
  format: ExportFormat,
  bgcs: ExportableBgc[],
  currentPage: number,
): void => {
  const content = serializeExport(bgcs, BGC_EXPORT_COLUMNS, format);
  downloadText(content, exportFilename(`bgcs_page${currentPage + 1}`, bgcs.length, bgcs.length, format), format);
};
