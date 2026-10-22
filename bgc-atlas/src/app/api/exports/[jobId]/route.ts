import { NextRequest, NextResponse } from 'next/server';
import { access, constants } from 'fs/promises';
import prisma from '@/lib/prisma';
import { summarizeFilterGroup, type FilterGroup } from '@/lib/filters/types';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import { publicJobError, serverError } from '@/lib/api/errors';
import type { SequenceHitFilters } from '@/lib/seqsearch/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which search a 'regions' export packaged. Older records carry no `source`. */
function searchSource(query: unknown): 'property' | 'sequence' {
  return (query as { source?: unknown } | null)?.source === 'sequence' ? 'sequence' : 'property';
}

/** A sequence-search export's session and the results table's filters, one per line. */
function sequenceConditions(query: unknown): string[] {
  const q = (query ?? {}) as { sessionId?: unknown; filters?: SequenceHitFilters };
  const f = q.filters ?? {};
  const lines = typeof q.sessionId === 'string' ? [`Search ${q.sessionId}`] : [];
  if (f.minIdentity !== undefined) lines.push(`Identity ≥ ${f.minIdentity}%`);
  if (f.minCoverage !== undefined) lines.push(`Coverage ≥ ${f.minCoverage}%`);
  if (f.queryFrom !== undefined && f.queryTo !== undefined) {
    const span = `${f.queryFrom.toLocaleString('en-US')}–${f.queryTo.toLocaleString('en-US')}`;
    lines.push(f.queryId ? `Query positions ${span} of ${f.queryId}` : `Query positions ${span}`);
  }
  return lines;
}

/** The search a 'regions' export packaged, as summary lines. */
function searchConditions(query: unknown): string[] {
  if (searchSource(query) === 'sequence') return sequenceConditions(query);
  let group = (query as { group?: FilterGroup | null } | null)?.group ?? null;
  // Unwrap single-group wrappers, or every line gets an operator prefix.
  while (group && group.conditions.length === 0 && group.groups.length === 1) group = group.groups[0];
  return summarizeFilterGroup(group, bgcPropertyFilterFields);
}

/** GET /api/exports/[jobId] */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    if (!UUID_RE.test(jobId)) {
      return NextResponse.json({ success: false, error: 'Export job not found' }, { status: 404 });
    }
    const exportJob = await prisma.gcfExportJob.findUnique({
      where: { id: jobId },
      include: {
        gcf: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!exportJob) {
      return NextResponse.json(
        { success: false, error: 'Export job not found' },
        { status: 404 }
      );
    }

    // Past expires_at the download answers 410, so the zip is not offered either.
    const expired = Boolean(exportJob.expires_at && exportJob.expires_at.getTime() <= Date.now());
    let fileExists = false;
    if (exportJob.output_path && exportJob.status === 'completed' && !exportJob.is_deleted && !expired) {
      try {
        await access(exportJob.output_path, constants.R_OK);
        fileExists = true;
      } catch {
        fileExists = false;
      }
    }

    const downloadUrl = fileExists ? `/api/exports/${exportJob.id}/download` : null;

    return NextResponse.json({
      success: true,
      data: {
        id: exportJob.id,
        kind: exportJob.kind === 'regions' ? 'regions' : 'gcf',
        gcfId: exportJob.gcf_id,
        gcfName: exportJob.gcf ? exportJob.gcf.name || exportJob.gcf_id : null,
        searchConditions: exportJob.kind === 'regions' ? searchConditions(exportJob.search_query) : [],
        searchSource: exportJob.kind === 'regions' ? searchSource(exportJob.search_query) : null,
        searchHref: exportJob.search_href,
        status: exportJob.status,
        progress: exportJob.progress || 0,
        totalBgcs: exportJob.total_bgcs,
        processedBgcs: exportJob.processed_bgcs || 0,
        missingFiles: exportJob.missing_files || 0,
        outputFilename: exportJob.output_filename,
        fileSizeBytes: exportJob.file_size_bytes ? Number(exportJob.file_size_bytes) : null,
        startedAt: exportJob.started_at?.toISOString() || null,
        completedAt: exportJob.completed_at?.toISOString() || null,
        durationMs: exportJob.duration_ms,
        errorMessage: exportJob.error_message ? publicJobError('export', exportJob.error_message) : null,
        expiresAt: exportJob.expires_at?.toISOString() || null,
        isDeleted: exportJob.is_deleted || false,
        fileExists,
        downloadUrl,
        createdAt: exportJob.created_at?.toISOString() || null,
      },
    });
  } catch (error) {
    return serverError(error, 'Error fetching export job status');
  }
}
