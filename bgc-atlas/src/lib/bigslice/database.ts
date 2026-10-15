import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { sanitizeErrorMessage } from './validation';
import { atlasGcfName, type BiGSliceTier } from './families';

export interface BiGSliceSessionData {
  sessionId: string;
  sessionHash: string;
  numFiles: number;
  totalFileSizeBytes: number;
  distanceThreshold: number;
  jobId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface BiGSliceSessionStatusUpdate {
  progress?: number;
  errorMessage?: string;
  totalMatches?: number;
  searchDurationMs?: number;
}

export interface BiGSliceSessionMetadata {
  sessionId: string;
  status: string;
  progress: number;
  totalMatches: number;
  searchDurationMs: number | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  parameters: {
    distanceThreshold: number;
    numFiles: number;
  };
}

export interface BiGSliceResultData {
  origFilename: string;       // original uploaded filename (already mapped back from the renamed file)
  bigsliceGcfId: number;      // raw gcf.id from the queried model -- ambiguous without `tier`
  tier: BiGSliceTier;         // which v3 model produced it
  distance: number;           // membership distance (lower = better fit)
  rank: number;               // assignment rank (0 = best)
}

export interface BiGSliceResultWithMetadata {
  resultId: string;
  sessionId: string;
  origFilename: string;
  bigsliceGcfId: number | null;
  tier: BiGSliceTier;
  distance: number;
  rank: number;
  createdAt: Date;
  /** Null when the family has no Atlas row -- see storeBigSliceResults. */
  gcfId: string | null;
  gcfName: string | null;
  petName: string | null;
  nBgc: number | null;
  domCategory: string | null;
}

export interface GetBiGSliceResultsOptions {
  limit?: number;
  offset?: number;
  minMembership?: number;
  sortBy?: 'membership' | 'distance' | 'filename';
  sortOrder?: 'asc' | 'desc';
}

export async function storeBigSliceSession(data: BiGSliceSessionData): Promise<void> {
  const {
    sessionId,
    sessionHash,
    numFiles,
    totalFileSizeBytes,
    distanceThreshold,
    jobId,
    ipAddress,
    userAgent,
  } = data;

  try {
    await prisma.$executeRaw`
      INSERT INTO bigslice_search_sessions (
        session_id,
        session_hash,
        num_files,
        total_file_size_bytes,
        distance_threshold,
        job_id,
        ip_address,
        user_agent,
        status,
        created_at
      ) VALUES (
        ${sessionId},
        ${sessionHash},
        ${numFiles},
        ${totalFileSizeBytes},
        ${distanceThreshold},
        ${jobId},
        ${ipAddress || null}::inet,
        ${userAgent || null},
        'pending',
        NOW()
      )
    `;

    console.log(`Stored BiG-SLiCE search session: ${sessionId}`);
  } catch (error) {
    console.error('Error storing BiG-SLiCE search session:', error);
    throw new Error(`Failed to store BiG-SLiCE session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function updateBigSliceSessionStatus(
  sessionId: string,
  status: 'running' | 'completed' | 'failed',
  metadata?: BiGSliceSessionStatusUpdate
): Promise<void> {
  try {
    const updates: Prisma.Sql[] = [Prisma.sql`status = ${status}`];
    const now = new Date();

    // Stamp the first transition into 'running' only — the worker sends several progress
    // updates per job, and re-stamping each time makes started_at mean "last update".
    if (status === 'running') {
      updates.push(Prisma.sql`started_at = COALESCE(started_at, ${now})`);
    }

    if (status === 'completed' || status === 'failed') {
      updates.push(Prisma.sql`completed_at = ${now}`);
    }

    if (metadata?.progress !== undefined) {
      updates.push(Prisma.sql`progress = ${metadata.progress}`);
    }

    if (metadata?.errorMessage) {
      const sanitizedError = sanitizeErrorMessage(metadata.errorMessage);
      updates.push(Prisma.sql`error_message = ${sanitizedError}`);
    }

    if (metadata?.totalMatches !== undefined) {
      updates.push(Prisma.sql`total_matches = ${metadata.totalMatches}`);
    }

    if (metadata?.searchDurationMs !== undefined) {
      updates.push(Prisma.sql`search_duration_ms = ${metadata.searchDurationMs}`);
    }

    await prisma.$executeRaw`
      UPDATE bigslice_search_sessions
      SET ${Prisma.join(updates, ', ')}
      WHERE session_id = ${sessionId}
    `;

    console.log(`Updated BiG-SLiCE session ${sessionId} to status: ${status}`);
  } catch (error) {
    console.error(`Error updating BiG-SLiCE session status for ${sessionId}:`, error);
    throw new Error(`Failed to update session status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getBigSliceSessionMetadata(sessionId: string): Promise<BiGSliceSessionMetadata | null> {
  try {
    type SessionRow = {
      session_id: string;
      status: string;
      progress: number | null;
      total_matches: number | null;
      search_duration_ms: number | null;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
      error_message: string | null;
      distance_threshold: string;
      num_files: number;
    };
    const result = await prisma.$queryRaw<SessionRow[]>`
      SELECT
        session_id,
        status,
        progress,
        total_matches,
        search_duration_ms,
        created_at,
        started_at,
        completed_at,
        error_message,
        distance_threshold,
        num_files
      FROM bigslice_search_sessions
      WHERE session_id = ${sessionId}
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      sessionId: row.session_id,
      status: row.status,
      progress: row.progress ?? 0,
      totalMatches: row.total_matches ?? 0,
      searchDurationMs: row.search_duration_ms,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      parameters: {
        distanceThreshold: parseFloat(row.distance_threshold),
        numFiles: row.num_files,
      },
    };

  } catch (error) {
    console.error('Error retrieving BiG-SLiCE session metadata:', error);
    return null;
  }
}

// Returns an existing session with the same file hash within maxAgeHours, else null.
export async function checkDuplicateBigSliceSearch(
  sessionHash: string,
  maxAgeHours: number = 24
): Promise<string | null> {
  try {
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    const result = await prisma.$queryRaw<Array<{ session_id: string }>>`
      SELECT session_id
      FROM bigslice_search_sessions
      WHERE session_hash = ${sessionHash}
        AND created_at > ${cutoffTime}
        AND status IN ('completed', 'running', 'pending')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length > 0) {
      console.log(`Found duplicate BiG-SLiCE search: ${result[0].session_id}`);
      return result[0].session_id;
    }

    return null;
  } catch (error) {
    console.error('Error checking for duplicate BiG-SLiCE search:', error);
    // Don't throw - if check fails, proceed with new search
    return null;
  }
}

export async function storeBigSliceResults(
  sessionId: string,
  results: BiGSliceResultData[]
): Promise<number> {
  if (results.length === 0) {
    console.log('No BiG-SLiCE results to store');
    return 0;
  }

  try {
    // One indexed `name = ANY(...)` lookup: v3 names are a pure function of (tier, raw id).
    const names = Array.from(new Set(results.map((r) => atlasGcfName(r.tier, r.bigsliceGcfId))));
    const gcfIdByName = await mapGcfNamesToIds(names);

    // A NULL gcf_id is expected: MIBiG-only reference families have no Atlas row.
    const unresolved = names.filter((name) => !gcfIdByName.has(name));
    if (unresolved.length > 0) {
      console.log(`${unresolved.length} of ${names.length} families have no Atlas row `
        + `(reference-only): ${unresolved.slice(0, 5).join(', ')}`);
    }

    const values = results.map((result) => {
      const gcfId = gcfIdByName.get(atlasGcfName(result.tier, result.bigsliceGcfId)) ?? null;
      return Prisma.sql`(
        uuid_generate_v4(),
        ${sessionId},
        ${result.origFilename},
        NULL,
        ${gcfId}::uuid,
        ${result.bigsliceGcfId},
        ${result.tier},
        ${result.distance},
        ${result.rank},
        NOW()
      )`;
    });

    // Batch insert in chunks of 500 to avoid parameter limit
    const chunkSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);

      const result = await prisma.$executeRaw`
        INSERT INTO bigslice_search_results (
          id,
          session_id,
          orig_filename,
          bgc_id,
          gcf_id,
          bigslice_gcf_id,
          tier,
          distance,
          rank,
          created_at
        )
        VALUES ${Prisma.join(chunk)}
      `;

      totalInserted += Number(result);
    }

    console.log(`Stored ${totalInserted} BiG-SLiCE results for session ${sessionId}`);
    return totalInserted;

  } catch (error) {
    console.error('Error storing BiG-SLiCE results:', error);
    throw new Error(`Failed to store BiG-SLiCE results: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getBigSliceSessionResults(
  sessionId: string,
  options: GetBiGSliceResultsOptions = {}
): Promise<BiGSliceResultWithMetadata[]> {
  const {
    limit = 50,
    offset = 0,
    sortBy = 'distance',
    sortOrder = 'asc',
  } = options;

  try {
    // Default: BiG-SLiCE distance; 'membership' falls back to rank.
    const orderByField = sortBy === 'filename' ? 'r.orig_filename'
      : sortBy === 'distance' ? 'r.distance'
        : 'r.rank';

    const orderDirection = sortOrder === 'desc' ? 'DESC' : 'ASC';
    // Keep each uploaded file's rows together, seed-model ranks first; the sort applies within a file.
    const orderByClause = Prisma.sql`ORDER BY r.orig_filename ASC, (r.tier = 'seed') DESC, ${Prisma.raw(orderByField)} ${Prisma.raw(orderDirection)}`;

    type ResultRow = {
      result_id: string;
      session_id: string;
      orig_filename: string;
      bigslice_gcf_id: number | null;
      tier: BiGSliceTier;
      distance: string;
      rank: number;
      created_at: Date;
      gcf_id: string | null;
      gcf_name: string | null;
      pet_name: string | null;
      n_bgc: number | null;
      dom_category: string | null;
    };
    // LEFT JOIN: a hit on a reference-only family has no `gcfs` row but is still a real answer.
    const results = await prisma.$queryRaw<ResultRow[]>`
      SELECT
        r.id AS result_id,
        r.session_id,
        r.orig_filename,
        r.bigslice_gcf_id,
        r.tier,
        r.distance,
        r.rank,
        r.created_at,
        g.id AS gcf_id,
        g.name AS gcf_name,
        g.pet_name,
        g.n_bgc,
        g.dom_category
      FROM bigslice_search_results r
      LEFT JOIN gcfs g ON g.id = r.gcf_id
      WHERE r.session_id = ${sessionId}
      ${orderByClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return results.map(row => ({
      resultId: row.result_id,
      sessionId: row.session_id,
      origFilename: row.orig_filename,
      bigsliceGcfId: row.bigslice_gcf_id,
      tier: row.tier,
      distance: parseFloat(row.distance),
      rank: row.rank,
      createdAt: row.created_at,
      gcfId: row.gcf_id,
      gcfName: row.gcf_name,
      petName: row.pet_name,
      nBgc: row.n_bgc,
      domCategory: row.dom_category,
    }));

  } catch (error) {
    console.error('Error retrieving BiG-SLiCE session results:', error);
    throw new Error(`Failed to retrieve session results: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function mapGcfNamesToIds(gcfNames: string[]): Promise<Map<string, string>> {
  if (gcfNames.length === 0) {
    return new Map();
  }

  try {
    const gcfs = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name
      FROM gcfs
      WHERE name = ANY(${gcfNames})
    `;

    const mapping = new Map<string, string>();
    gcfs.forEach(gcf => {
      mapping.set(gcf.name, gcf.id);
    });

    const unmapped = gcfNames.filter(name => !mapping.has(name));
    if (unmapped.length > 0) {
      console.warn(`Unmapped GCF names (${unmapped.length}/${gcfNames.length}):`, unmapped.slice(0, 10));

      // If more than 50% unmapped, this might indicate a data sync issue
      if (unmapped.length > gcfNames.length * 0.5) {
        console.error('WARNING: More than 50% of GCF names are unmapped! Check database synchronization.');
      }
    } else {
      console.log(`Successfully mapped all ${gcfNames.length} GCF names to UUIDs`);
    }

    return mapping;

  } catch (error) {
    console.error('Error mapping GCF names to IDs:', error);
    throw new Error(`Failed to map GCF names: ${error instanceof Error ? error.message : String(error)}`);
  }
}
