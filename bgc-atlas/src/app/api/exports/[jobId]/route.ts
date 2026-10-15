import { NextRequest, NextResponse } from 'next/server';
import { access, constants } from 'fs/promises';
import prisma from '@/lib/prisma';
import { summarizeFilterGroup, type FilterGroup } from '@/lib/filters/types';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import { publicJobError, serverError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function searchConditions(query: unknown): string[] {
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

    let fileExists = false;
    if (exportJob.output_path && exportJob.status === 'completed' && !exportJob.is_deleted) {
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
