import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { sanitizeErrorMessage } from '@/lib/bigslice/validation';
import { EXPORT_INTERRUPTED_MESSAGE, SEARCH_INTERRUPTED_MESSAGE } from '@/lib/api/errors';
import type { ExportJob, SearchJob } from './index';

/**
 * Closing a job's database record when the job ends without its processor doing it.
 *
 * The results page, /exports/<id> and the duplicate-search check all read the
 * record (sequence_search_sessions, bigslice_search_sessions, gcf_export_jobs),
 * not the BullMQ job. Only the processors wrote 'failed' to it, from their own
 * catch blocks, so a job that ended any other way left the record 'pending' or
 * 'running' and every page polling it waited forever: a job failed by BullMQ for
 * stalling across a restart, an admin cancel, an admin delete. And the sequence
 * processor wrote 'failed' on an attempt the queue was about to RETRY, so an open
 * results tab stopped polling and kept showing a failure the retry then fixed.
 *
 * Now the record is closed here, once the job is finally over: from the worker's
 * 'failed' event when no retry is left, from admin cancel/delete, and by
 * closeOrphanedJobRecords for whatever slips past both.
 */

const OPEN = ['pending', 'running'];

type JobData = SearchJob | ExportJob;

/** Mark the job's record failed with `message`, unless it already finished. Returns whether it changed. */
export async function closeJobRecord(data: JobData, message: string): Promise<boolean> {
  const error = sanitizeErrorMessage(message);
  let changed: number;
  if (data.type === 'sequence' || data.type === 'bgc') {
    const table = data.type === 'sequence'
      ? Prisma.sql`sequence_search_sessions`
      : Prisma.sql`bigslice_search_sessions`;
    changed = await prisma.$executeRaw`
      UPDATE ${table}
      SET status = 'failed', completed_at = now(), error_message = ${error}
      WHERE session_id = ${data.sessionId} AND status = ANY(${OPEN})
    `;
  } else {
    changed = (await prisma.gcfExportJob.updateMany({
      where: { id: data.exportJobId, status: { in: OPEN } },
      data: { status: 'failed', completed_at: new Date(), error_message: error },
    })).count;
  }
  return changed > 0;
}

/** How long a record may sit open with no queue job before it counts as orphaned. */
export const ORPHAN_AFTER_MINUTES = 30;

/**
 * Close every record still open after ORPHAN_AFTER_MINUTES whose job is in no live
 * queue state. `liveSearchJobIds` / `liveExportJobIds` are the ids of the waiting,
 * active, delayed and prioritized jobs of each queue; the caller must pass complete
 * sets (an empty set means "no live job", and closes every old open record).
 */
export async function closeOrphanedJobRecords(
  liveSearchJobIds: ReadonlySet<string>,
  liveExportJobIds: ReadonlySet<string>,
): Promise<{ sequence: number; bgc: number; export: number }> {
  const search = [...liveSearchJobIds];
  const exports = [...liveExportJobIds];
  // Casts: Prisma binds a JS number as bigint, and make_interval has no bigint form.
  const cutoff = Prisma.sql`now() - make_interval(mins => ${ORPHAN_AFTER_MINUTES}::int)`;
  const orphaned = (table: Prisma.Sql, live: string[], message: string) => prisma.$executeRaw`
    UPDATE ${table}
    SET status = 'failed', completed_at = now(), error_message = ${message}
    WHERE status = ANY(${OPEN}) AND created_at < ${cutoff}
      AND (job_id IS NULL OR NOT (job_id = ANY(${live}::text[])))
  `;
  const [sequence, bgc, exported] = await Promise.all([
    orphaned(Prisma.sql`sequence_search_sessions`, search, SEARCH_INTERRUPTED_MESSAGE),
    orphaned(Prisma.sql`bigslice_search_sessions`, search, SEARCH_INTERRUPTED_MESSAGE),
    orphaned(Prisma.sql`gcf_export_jobs`, exports, EXPORT_INTERRUPTED_MESSAGE),
  ]);
  return { sequence, bgc, export: exported };
}
