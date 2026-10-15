import prisma from '@/lib/prisma';
import { searchBrowseIndexWithBody } from '@/lib/opensearch/browse-client';
import type { RegionSource } from '@/lib/bgc-download/read-region';

// Read from bgc_browse, never bgcs: N scattered cold reads on PostgreSQL would spend the whole
// statement timeout. Documents without archive_path fall back to antismash_runs per distinct run.

export interface ExportRegion extends RegionSource {
  bgcId: string;
  /** Where this region sits in the combined downloads archive, when indexed. */
  gbkOffset: number | null;
  gbkLength: number | null;
}

const IDS_PER_REQUEST = 1000;
const RUNS_PER_QUERY = 500;
const SOURCE_FIELDS = ['bgc_id', 'filename', 'antismash_run_id', 'archive_path', 'gbk_offset', 'gbk_length'];

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function toExportRegion(doc: Record<string, unknown>): ExportRegion | null {
  const bgcId = text(doc.bgc_id);
  const filename = text(doc.filename);
  if (!bgcId || !filename) return null;
  return {
    bgcId,
    filename,
    runId: text(doc.antismash_run_id),
    archivePath: text(doc.archive_path),
    gbkOffset: count(doc.gbk_offset),
    gbkLength: count(doc.gbk_length),
  };
}

async function fillMissingArchivePaths(regions: ExportRegion[]): Promise<void> {
  const runIds = [...new Set(regions.filter((r) => !r.archivePath && r.runId).map((r) => r.runId as string))];
  if (!runIds.length) return;
  const paths = new Map<string, string>();
  for (let i = 0; i < runIds.length; i += RUNS_PER_QUERY) {
    const rows = await prisma.antiSmashRun.findMany({
      where: { id: { in: runIds.slice(i, i + RUNS_PER_QUERY) } },
      select: { id: true, file_path: true },
    });
    for (const row of rows) if (row.file_path) paths.set(row.id, row.file_path);
  }
  for (const r of regions) {
    if (!r.archivePath && r.runId) r.archivePath = paths.get(r.runId) ?? null;
  }
}

const byFilename = (a: ExportRegion, b: ExportRegion) => a.filename.localeCompare(b.filename);

/** The regions of these BGCs, in filename order. Ids bgc_browse does not hold are dropped. */
export async function exportRegionsByIds(bgcIds: string[]): Promise<ExportRegion[]> {
  const regions: ExportRegion[] = [];
  for (let i = 0; i < bgcIds.length; i += IDS_PER_REQUEST) {
    const chunk = bgcIds.slice(i, i + IDS_PER_REQUEST);
    const { documents } = await searchBrowseIndexWithBody('bgcs', {
      size: chunk.length,
      _source: SOURCE_FIELDS,
      track_total_hits: false,
      query: { ids: { values: chunk } },
    });
    for (const doc of documents) {
      const region = toExportRegion(doc);
      if (region) regions.push(region);
    }
  }
  await fillMissingArchivePaths(regions);
  return regions.sort(byFilename);
}

// bgc_browse.gcf_id is the primary family (bgc_gcf.is_primary), which is what the export packages.
export async function exportRegionsByGcf(gcfId: string): Promise<ExportRegion[]> {
  const regions: ExportRegion[] = [];
  let after: string | null = null;
  for (;;) {
    const { documents } = await searchBrowseIndexWithBody('bgcs', {
      size: IDS_PER_REQUEST,
      _source: SOURCE_FIELDS,
      track_total_hits: false,
      query: { term: { gcf_id: gcfId } },
      sort: [{ bgc_id: 'asc' }],
      ...(after ? { search_after: [after] } : {}),
    });
    for (const doc of documents) {
      const region = toExportRegion(doc);
      if (region) regions.push(region);
    }
    if (documents.length < IDS_PER_REQUEST) break;
    after = text(documents[documents.length - 1].bgc_id);
    if (!after) break;
  }
  await fillMissingArchivePaths(regions);
  return regions.sort(byFilename);
}
