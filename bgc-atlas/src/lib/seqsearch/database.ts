import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { sanitizeErrorMessage } from '@/lib/bigslice/validation';
import type { SeqSearchHit } from './types';
import { parseTargetId } from './target-id';
import { looksLikeGenbank, parseGenbank, type GenbankCds, type GeneKind } from './genbank';

export interface SessionData {
  sessionId: string;
  inputSequence: string;
  sequenceHash: string;
  sequenceType: 'nucleotide' | 'protein';
  parameters: {
    algorithm: string;
    eValue: number;
    minIdentity: number;
    minCoverage: number;
    maxResults: number;
  };
  jobId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionStatusUpdate {
  progress?: number;
  errorMessage?: string;
  totalHits?: number;
  searchDurationMs?: number;
}

// Grouped by BGC alone, not (BGC, query): a GenBank submission searches one query per CDS.
export interface ResultGroup {
  groupKey: string;
  queryIds: string[];
  bgcId: string | null;
  bgcFilename: string | null;
  cdsHits: number;
  bestIdentity: number;
  bestCoverage: number;
  bestEValue: number;
  bestBitScore: number;
}

export interface ResultHit {
  resultId: string;
  bgcId: string | null;
  targetId: string;
  cdsLabel: string;
  queryId: string | null;
  identity: number;
  coverage: number;
  eValue: number;
  bitScore: number;
  queryStart: number;
  queryEnd: number;
  queryLength: number;
  targetStart: number;
  targetEnd: number;
  targetLength: number;
  alignmentLength: number;
  mismatches: number;
  gaps: number;
  rank: number;
  /** Null for sessions searched before these were captured. */
  queryAligned: string | null;
  targetAligned: string | null;
}

export interface GetResultGroupsOptions {
  limit?: number;
  offset?: number;
  minIdentity?: number;
  minCoverage?: number;
  /** Restrict to hits overlapping this span of the query (contig-map locus click). */
  queryFrom?: number;
  queryTo?: number;
  sortBy?: 'evalue' | 'identity' | 'bitscore' | 'querygenes';
  sortOrder?: 'asc' | 'desc';
  queryId?: string;
}

// Shared by the group and hit queries so a group and its expansion can never disagree.
const GROUP_KEY = Prisma.sql`
  COALESCE(
    r.bgc_id::text,
    CASE WHEN r.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_'
         THEN left(r.target_id, 36)
         ELSE r.target_id
    END
  )
`;

export async function storeSearchSession(data: SessionData): Promise<void> {
  const { sessionId, inputSequence, sequenceHash, sequenceType, parameters, jobId, ipAddress, userAgent } = data;

  try {
    await prisma.$executeRaw`
      INSERT INTO sequence_search_sessions (
        session_id, input_sequence, sequence_hash, sequence_type, algorithm,
        e_value, min_identity, min_coverage, max_results,
        job_id, ip_address, user_agent, status, created_at
      ) VALUES (
        ${sessionId}, ${inputSequence}, ${sequenceHash}, ${sequenceType}, ${parameters.algorithm},
        ${parameters.eValue}, ${parameters.minIdentity}, ${parameters.minCoverage},
        ${parameters.maxResults},
        ${jobId}, ${ipAddress || null}::inet, ${userAgent || null}, 'pending', NOW()
      )
    `;
    console.log(`Stored search session: ${sessionId}`);
  } catch (error) {
    console.error('Error storing search session:', error);
    throw new Error(`Failed to store search session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function updateSessionStatus(
  sessionId: string,
  status: 'running' | 'completed' | 'failed',
  metadata?: SessionStatusUpdate,
): Promise<void> {
  try {
    const updates: Prisma.Sql[] = [Prisma.sql`status = ${status}`];
    const now = new Date();

    // Only the first transition into 'running' stamps started_at.
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
      updates.push(Prisma.sql`error_message = ${sanitizeErrorMessage(metadata.errorMessage)}`);
    } else if (status === 'completed') {
      // A job that succeeds on retry must not keep the failed attempt's error.
      updates.push(Prisma.sql`error_message = NULL`);
    }
    if (metadata?.totalHits !== undefined) {
      updates.push(Prisma.sql`total_hits = ${metadata.totalHits}`);
    }
    if (metadata?.searchDurationMs !== undefined) {
      updates.push(Prisma.sql`search_duration_ms = ${metadata.searchDurationMs}`);
    }

    await prisma.$executeRaw`
      UPDATE sequence_search_sessions
      SET ${Prisma.join(updates, ', ')}
      WHERE session_id = ${sessionId}
    `;
    console.log(`Updated session ${sessionId} to status: ${status}`);
  } catch (error) {
    console.error(`Error updating session status for ${sessionId}:`, error);
    throw new Error(`Failed to update session status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function checkDuplicateSearch(
  sequenceHash: string,
  maxAgeHours: number = 24,
): Promise<string | null> {
  try {
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const result = await prisma.$queryRaw<Array<{ session_id: string }>>`
      SELECT session_id
      FROM sequence_search_sessions
      WHERE sequence_hash = ${sequenceHash}
        AND created_at > ${cutoffTime}
        AND status IN ('completed', 'running', 'pending')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (result.length > 0) {
      console.log(`Found duplicate search: ${result[0].session_id}`);
      return result[0].session_id;
    }
    return null;
  } catch (error) {
    console.error('Error checking for duplicate search:', error);
    return null; // a failed check must not block a new search
  }
}

/**
 * `bgc_id` is left(target_id, 36) by construction (both are the uuid5 of the region filename)
 * and is deliberately not validated against `bgcs`: one random read per hit exceeds the
 * statement timeout on large uploads. Readers LEFT JOIN.
 *
 * Rank is per query sequence. `coverage` is the side the search filtered on: query for
 * blastp, subject for blastx (see buildDiamondArgs).
 */
export async function storeSearchResults(
  sessionId: string,
  hits: SeqSearchHit[],
  sequenceType: 'nucleotide' | 'protein' = 'protein',
): Promise<number> {
  if (hits.length === 0) {
    console.log('No hits to store');
    return 0;
  }

  try {
    // Idempotent, so a retry resuming from a reused DIAMOND output doesn't duplicate hits.
    const discarded = await prisma.$executeRaw`
      DELETE FROM sequence_search_results WHERE session_id = ${sessionId}
    `;
    if (discarded > 0) {
      console.log(`Discarded ${discarded} rows from an earlier attempt at session ${sessionId}`);
    }

    const ranksByQuery = new Map<string, number>();
    const ordered = [...hits].sort(
      (a, b) => a.queryId.localeCompare(b.queryId) || a.eValue - b.eValue || b.bitScore - a.bitScore,
    );

    const values = ordered.map((hit) => {
      const rank = (ranksByQuery.get(hit.queryId) ?? 0) + 1;
      ranksByQuery.set(hit.queryId, rank);

      const { regionId } = parseTargetId(hit.targetId);

      return Prisma.sql`(
        uuid_generate_v4(),
        ${sessionId},
        ${regionId}::uuid,
        ${null},
        ${hit.targetId},
        ${hit.queryId},
        ${hit.identity},
        ${sequenceType === 'nucleotide' ? hit.targetCoverage : hit.queryCoverage},
        ${hit.eValue},
        ${hit.bitScore},
        ${hit.queryStart},
        ${hit.queryEnd},
        ${hit.queryLen},
        ${hit.targetStart},
        ${hit.targetEnd},
        ${hit.targetLen},
        ${hit.alignmentLength - hit.mismatches},
        ${hit.mismatches},
        ${hit.gapOpens},
        ${hit.alignmentLength},
        ${hit.queryAligned ?? null},
        ${hit.targetAligned ?? null},
        ${rank},
        NOW()
      )`;
    });

    const chunkSize = 500; // stays under the bind-parameter limit
    let totalInserted = 0;

    for (let i = 0; i < values.length; i += chunkSize) {
      const inserted = await prisma.$executeRaw`
        INSERT INTO sequence_search_results (
          id, session_id, bgc_id, bgc_filename, target_id, query_id,
          identity, coverage, e_value, bit_score,
          query_start, query_end, query_length,
          target_start, target_end, target_length,
          num_matches, num_mismatches, num_gaps, alignment_length,
          query_aligned, target_aligned,
          rank, created_at
        )
        VALUES ${Prisma.join(values.slice(i, i + chunkSize))}
      `;
      totalInserted += Number(inserted);
    }

    const linkable = ordered.filter(h => parseTargetId(h.targetId).regionId !== null).length;
    console.log(`Stored ${totalInserted} results for session ${sessionId} (${linkable} carry an Atlas region id)`);

    return totalInserted;
  } catch (error) {
    console.error('Error storing search results:', error);
    throw new Error(`Failed to store search results: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function filterConditions(sessionId: string, options: GetResultGroupsOptions): Prisma.Sql[] {
  const conditions = [Prisma.sql`r.session_id = ${sessionId}`];
  if (options.minIdentity !== undefined) conditions.push(Prisma.sql`r.identity >= ${options.minIdentity}`);
  if (options.minCoverage !== undefined) conditions.push(Prisma.sql`r.coverage >= ${options.minCoverage}`);
  if (options.queryId !== undefined) conditions.push(Prisma.sql`r.query_id = ${options.queryId}`);
  // Overlap, not containment. Minus-strand rows store start > end.
  if (options.queryFrom !== undefined && options.queryTo !== undefined) {
    conditions.push(Prisma.sql`
      least(r.query_start, r.query_end) <= ${options.queryTo}
      AND greatest(r.query_start, r.query_end) >= ${options.queryFrom}
    `);
  }
  return conditions;
}

export async function getResultGroups(
  sessionId: string,
  options: GetResultGroupsOptions = {},
): Promise<{ groups: ResultGroup[]; total: number }> {
  const { limit = 25, offset = 0, sortBy = 'evalue', sortOrder = 'asc' } = options;

  try {
    const where = Prisma.sql`WHERE ${Prisma.join(filterConditions(sessionId, options), ' AND ')}`;

    const orderBy = sortBy === 'querygenes'
      ? Prisma.sql`ORDER BY count(DISTINCT r.query_id) ${Prisma.raw(sortOrder === 'asc' ? 'ASC' : 'DESC')}, max(r.bit_score) DESC`
      : sortBy === 'identity'
      ? Prisma.sql`ORDER BY max(r.identity) ${Prisma.raw(sortOrder === 'asc' ? 'ASC' : 'DESC')}, min(r.e_value) ASC`
      : sortBy === 'bitscore'
        ? Prisma.sql`ORDER BY max(r.bit_score) ${Prisma.raw(sortOrder === 'asc' ? 'ASC' : 'DESC')}, min(r.e_value) ASC`
        : Prisma.sql`ORDER BY min(r.e_value) ${Prisma.raw(sortOrder === 'desc' ? 'DESC' : 'ASC')}, max(r.bit_score) DESC`;

    type GroupRow = {
      group_key: string;
      query_ids: string[] | null;
      bgc_id: string | null;
      bgc_filename: string | null;
      cds_hits: number;
      best_identity: string;
      best_coverage: string;
      best_e_value: number;
      best_bit_score: string;
    };

    const rows = await prisma.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT
        ${GROUP_KEY}            AS group_key,
        array_remove(
          array_agg(DISTINCT r.query_id ORDER BY r.query_id),
          NULL
        )                       AS query_ids,
        -- Postgres has no max(uuid).
        max(r.bgc_id::text)     AS bgc_id,
        max(r.bgc_filename)     AS bgc_filename,
        count(*)::int           AS cds_hits,
        max(r.identity)         AS best_identity,
        max(r.coverage)         AS best_coverage,
        min(r.e_value)          AS best_e_value,
        max(r.bit_score)        AS best_bit_score
      FROM sequence_search_results r
      ${where}
      GROUP BY 1
      ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM (
        SELECT 1 FROM sequence_search_results r ${where} GROUP BY ${GROUP_KEY}
      ) g
    `);

    return {
      groups: rows.map(row => ({
        groupKey: row.group_key,
        queryIds: row.query_ids ?? [],
        bgcId: row.bgc_id,
        bgcFilename: row.bgc_filename,
        cdsHits: row.cds_hits,
        bestIdentity: parseFloat(row.best_identity),
        bestCoverage: parseFloat(row.best_coverage),
        bestEValue: Number(row.best_e_value),
        bestBitScore: parseFloat(row.best_bit_score),
      })),
      total: Number(count),
    };
  } catch (error) {
    console.error('Error retrieving result groups:', error);
    throw new Error(`Failed to retrieve result groups: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getGroupHits(
  sessionId: string,
  groupKey: string,
  options: { minIdentity?: number; minCoverage?: number } = {},
): Promise<ResultHit[]> {
  try {
    const conditions = filterConditions(sessionId, options);
    conditions.push(Prisma.sql`${GROUP_KEY} = ${groupKey}`);

    type HitRow = {
      result_id: string;
      bgc_id: string | null;
      target_id: string | null;
      query_id: string | null;
      identity: string;
      coverage: string;
      e_value: number;
      bit_score: string;
      query_start: number;
      query_end: number;
      query_length: number;
      target_start: number;
      target_end: number;
      target_length: number;
      alignment_length: number;
      num_mismatches: number | null;
      num_gaps: number | null;
      rank: number;
      query_aligned: string | null;
      target_aligned: string | null;
    };

    const rows = await prisma.$queryRaw<HitRow[]>(Prisma.sql`
      SELECT
        r.id::text AS result_id,
        r.bgc_id::text AS bgc_id,
        r.target_id, r.query_id, r.identity, r.coverage, r.e_value, r.bit_score,
        r.query_start, r.query_end, r.query_length,
        r.target_start, r.target_end, r.target_length,
        r.alignment_length, r.num_mismatches, r.num_gaps, r.rank,
        r.query_aligned, r.target_aligned
      FROM sequence_search_results r
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY r.e_value ASC, r.bit_score DESC
    `);

    return rows.map(row => ({
      resultId: row.result_id,
      bgcId: row.bgc_id,
      targetId: row.target_id ?? '',
      cdsLabel: parseTargetId(row.target_id ?? '').cdsLabel,
      queryId: row.query_id,
      identity: parseFloat(row.identity),
      coverage: parseFloat(row.coverage),
      eValue: Number(row.e_value),
      bitScore: parseFloat(row.bit_score),
      queryStart: row.query_start,
      queryEnd: row.query_end,
      queryLength: row.query_length,
      targetStart: row.target_start,
      targetEnd: row.target_end,
      targetLength: row.target_length,
      alignmentLength: row.alignment_length,
      mismatches: row.num_mismatches ?? 0,
      gaps: row.num_gaps ?? 0,
      rank: row.rank,
      queryAligned: row.query_aligned,
      targetAligned: row.target_aligned,
    }));
  } catch (error) {
    console.error('Error retrieving group hits:', error);
    throw new Error(`Failed to retrieve group hits: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// For CSV export.
export async function getAllSessionHits(sessionId: string): Promise<ResultHit[]> {
  const rows = await prisma.$queryRaw<Array<{
    result_id: string; target_id: string | null; query_id: string | null;
    identity: string; coverage: string; e_value: number; bit_score: string;
    query_start: number; query_end: number; query_length: number;
    target_start: number; target_end: number; target_length: number;
    alignment_length: number; num_mismatches: number | null; num_gaps: number | null;
    rank: number; bgc_id: string | null;
  }>>`
    SELECT
      r.id::text AS result_id, r.target_id, r.query_id, r.identity, r.coverage,
      r.e_value, r.bit_score, r.query_start, r.query_end, r.query_length,
      r.target_start, r.target_end, r.target_length, r.alignment_length,
      r.num_mismatches, r.num_gaps, r.rank, r.bgc_id::text AS bgc_id
    FROM sequence_search_results r
    WHERE r.session_id = ${sessionId}
    ORDER BY r.query_id, r.rank
  `;

  return rows.map(row => ({
    resultId: row.result_id,
    bgcId: row.bgc_id,
    targetId: row.target_id ?? '',
    cdsLabel: parseTargetId(row.target_id ?? '').cdsLabel,
    queryId: row.query_id,
    identity: parseFloat(row.identity),
    coverage: parseFloat(row.coverage),
    eValue: Number(row.e_value),
    bitScore: parseFloat(row.bit_score),
    queryStart: row.query_start,
    queryEnd: row.query_end,
    queryLength: row.query_length,
    targetStart: row.target_start,
    targetEnd: row.target_end,
    targetLength: row.target_length,
    alignmentLength: row.alignment_length,
    mismatches: row.num_mismatches ?? 0,
    gaps: row.num_gaps ?? 0,
    rank: row.rank,
    queryAligned: null,
    targetAligned: null,
  }));
}

// DIAMOND applies `--max-target-seqs` per query, so truncation is per query, not session-wide.
export async function getTruncatedQueries(sessionId: string, maxResults: number): Promise<string[]> {
  if (!maxResults) return [];
  const rows = await prisma.$queryRaw<Array<{ query_id: string | null }>>`
    SELECT query_id
    FROM sequence_search_results
    WHERE session_id = ${sessionId}
    GROUP BY query_id
    HAVING count(*) >= ${maxResults}
  `;
  return rows.map(r => r.query_id ?? '');
}

export async function getSessionMetadata(sessionId: string): Promise<{
  sessionId: string;
  status: string;
  totalHits: number;
  searchDurationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  sequenceType: string;
  maxResults: number;
  /** A nucleotide search, or a GenBank record searched by its CDS translations. */
  hasContigMap: boolean;
  /** Unaffected by any table filter. */
  totalGroups: number;
  parameters: { eValue: number; minIdentity: number; minCoverage: number };
} | null> {
  try {
    type SessionRow = {
      session_id: string;
      status: string;
      total_hits: number | null;
      search_duration_ms: number | null;
      created_at: Date;
      completed_at: Date | null;
      error_message: string | null;
      sequence_type: string;
      max_results: number | null;
      e_value: number;
      min_identity: string;
      min_coverage: string;
      is_genbank: boolean;
      total_groups: bigint;
    };
    const result = await prisma.$queryRaw<SessionRow[]>`
      SELECT session_id, status, total_hits, search_duration_ms, created_at, completed_at,
             error_message, sequence_type, max_results, e_value, min_identity, min_coverage,
             (input_sequence ~ '^LOCUS\\s+\\S') AS is_genbank,
             (SELECT count(DISTINCT ${GROUP_KEY}) FROM sequence_search_results r
               WHERE r.session_id = ${sessionId}) AS total_groups
      FROM sequence_search_sessions
      WHERE session_id = ${sessionId}
      LIMIT 1
    `;

    if (result.length === 0) return null;

    const row = result[0];
    return {
      sessionId: row.session_id,
      status: row.status,
      totalHits: row.total_hits ?? 0,
      searchDurationMs: row.search_duration_ms,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      sequenceType: row.sequence_type,
      maxResults: row.max_results ?? 0,
      hasContigMap: row.sequence_type === 'nucleotide' || row.is_genbank,
      totalGroups: Number(row.total_groups ?? 0),
      parameters: {
        eValue: Number(row.e_value),
        minIdentity: parseFloat(row.min_identity),
        minCoverage: parseFloat(row.min_coverage),
      },
    };
  } catch (error) {
    console.error('Error retrieving session metadata:', error);
    return null;
  }
}

/** A run of overlapping hits on one strand of the query. */
export interface ContigLocus {
  /** Matches ContigMap.queries[].queryId; a GenBank CDS search has one contig but a query_id per gene. */
  contig: string | null;
  queryId: string | null;
  start: number;
  end: number;
  strand: '+' | '-';
  hits: number;
  bgcs: number;
  avgIdentity: number;
  bestBitScore: number;
}

export interface ContigHit {
  /** See ContigLocus.contig. */
  contig: string | null;
  groupKey: string;
  queryId: string | null;
  start: number;
  end: number;
  strand: '+' | '-';
  identity: number;
  bitScore: number;
  bgcId: string | null;
  bgcFilename: string | null;
  cdsLabel: string;
}

export interface QueryGene {
  locusTag: string;
  start: number;
  end: number;
  strand: '+' | '-';
  isCore: boolean;
  /** antiSMASH /gene_kind; absent outside a detected region. */
  geneKind?: GeneKind;
  product?: string;
  hits: number;
  bgcs: number;
  bestBitScore: number;
  /** Its query hit the result cap, so the depth is a floor. */
  truncated: boolean;
}

export interface ContigMap {
  /** Only when a GenBank record was searched by its CDS translations. */
  queryGenes: QueryGene[] | null;
  queries: { queryId: string | null; length: number; hits: number }[];
  loci: ContigLocus[];
  hits: ContigHit[];
  shownGroups: number;
  totalGroups: number;
  totalHits: number;
}

// A minus-strand blastx hit is stored with query_start > query_end.
const SPAN = Prisma.sql`
  least(query_start, query_end) AS s,
  greatest(query_start, query_end) AS e,
  (query_end < query_start) AS minus
`;

// CDS-mode coordinates are along the translation; project them proportionally onto the gene's span.
function projectOntoGene(
  gene: GenbankCds,
  queryStart: number,
  queryEnd: number,
  queryLength: number,
): { start: number; end: number } {
  const span = gene.end - gene.start;
  if (!queryLength || span <= 0) return { start: gene.start, end: gene.end };

  const from = Math.min(queryStart, queryEnd);
  const to = Math.max(queryStart, queryEnd);
  const headFraction = Math.max(0, (from - 1) / queryLength);
  const tailFraction = Math.min(1, to / queryLength);

  const a = gene.strand === '-'
    ? gene.end - tailFraction * span
    : gene.start + headFraction * span;
  const b = gene.strand === '-'
    ? gene.end - headFraction * span
    : gene.start + tailFraction * span;

  return { start: Math.round(Math.min(a, b)), end: Math.round(Math.max(a, b)) };
}

async function loadQueryRecord(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{ input_sequence: string; sequence_type: string }>>(Prisma.sql`
    SELECT input_sequence, sequence_type FROM sequence_search_sessions WHERE session_id = ${sessionId}
  `);
  const row = rows[0];
  if (!row || !looksLikeGenbank(row.input_sequence)) return null;
  const record = parseGenbank(row.input_sequence);
  if (!record) return null;
  // Protein search = CDS translations (query_id is a locus_tag); nucleotide = blastx over
  // ORIGIN, where hits already carry contig coordinates.
  return row.sequence_type === 'protein' ? record : null;
}

export async function getContigMap(sessionId: string, groupLimit = 30): Promise<ContigMap> {
  const queryRecord = await loadQueryRecord(sessionId);

  const [{ max_results: maxResults }] = await prisma.$queryRaw<Array<{ max_results: number | null }>>(
    Prisma.sql`SELECT max_results FROM sequence_search_sessions WHERE session_id = ${sessionId}`
  );
  const truncatedQueries = new Set(await getTruncatedQueries(sessionId, maxResults ?? 0));
  // A row starts a new locus when its start clears every preceding end on that strand.
  const lociRows = await prisma.$queryRaw<Array<{
    query_id: string | null; minus: boolean; start: number; end: number;
    hits: bigint; bgcs: bigint; avg_identity: string; best_bit_score: string;
  }>>(Prisma.sql`
    WITH h AS (
      SELECT query_id, identity, bit_score, bgc_id, ${SPAN}
      FROM sequence_search_results
      WHERE session_id = ${sessionId}
    ),
    ordered AS (
      SELECT *, max(e) OVER (
        PARTITION BY query_id, minus ORDER BY s, e
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS prev_max
      FROM h
    ),
    grouped AS (
      SELECT *, count(*) FILTER (WHERE prev_max IS NULL OR s > prev_max) OVER (
        PARTITION BY query_id, minus ORDER BY s, e
      ) AS locus
      FROM ordered
    )
    SELECT query_id, minus,
           min(s)::int AS start, max(e)::int AS end,
           count(*) AS hits, count(DISTINCT bgc_id) AS bgcs,
           avg(identity)::text AS avg_identity, max(bit_score)::text AS best_bit_score
    FROM grouped
    GROUP BY query_id, minus, locus
    ORDER BY min(s)
  `);

  // Top BGCs by best hit, then every hit of theirs; a global top-N of hits would make
  // matches look fragmentary and hide whole loci.
  const hitRows = await prisma.$queryRaw<Array<{
    group_key: string; query_id: string | null; minus: boolean; s: number; e: number;
    identity: string; bit_score: string; bgc_id: string | null;
    bgc_filename: string | null; target_id: string | null; query_length: number;
  }>>(Prisma.sql`
    WITH ranked AS (
      SELECT ${GROUP_KEY} AS group_key, max(bit_score) AS best, max(r.bgc_id::text) AS bgc_id
      FROM sequence_search_results r
      WHERE r.session_id = ${sessionId}
      GROUP BY ${GROUP_KEY}
      ORDER BY best DESC
      LIMIT ${groupLimit}
    )
    SELECT ranked.group_key,
           r.query_id, r.bgc_id::text AS bgc_id, b.filename AS bgc_filename, r.target_id,
           r.identity, r.bit_score, r.query_length,
           least(r.query_start, r.query_end) AS s,
           greatest(r.query_start, r.query_end) AS e,
           (r.query_end < r.query_start) AS minus
    FROM sequence_search_results r
    JOIN ranked ON ranked.group_key = ${GROUP_KEY}
    -- Joined on ranked, not r: at most groupLimit lookups into bgcs, not one per hit.
    LEFT JOIN bgcs b ON b.id = ranked.bgc_id::uuid
    WHERE r.session_id = ${sessionId}
    ORDER BY ranked.best DESC, ranked.group_key, s
  `);

  const queryRows = await prisma.$queryRaw<Array<{
    query_id: string | null; length: number; hits: bigint;
  }>>(Prisma.sql`
    SELECT query_id, max(query_length)::int AS length, count(*) AS hits
    FROM sequence_search_results
    WHERE session_id = ${sessionId}
    GROUP BY query_id
    ORDER BY count(*) DESC, query_id
  `);

  const totalHits = queryRows.reduce((sum, row) => sum + Number(row.hits), 0);

  const [{ groups: totalGroupsRaw }] = await prisma.$queryRaw<Array<{ groups: bigint }>>(Prisma.sql`
    SELECT count(DISTINCT ${GROUP_KEY}) AS groups
    FROM sequence_search_results r
    WHERE r.session_id = ${sessionId}
  `);
  const totalGroups = Number(totalGroupsRaw);

  const geneByTag = new Map(queryRecord?.cdsFeatures.map((cds) => [cds.locusTag, cds]) ?? []);

  const placedHits = hitRows.map((row) => {
    const gene = row.query_id ? geneByTag.get(row.query_id) : undefined;
    if (!gene) return { row, start: row.s, end: row.e, strand: row.minus ? ('-' as const) : ('+' as const) };
    const projected = projectOntoGene(gene, row.s, row.e, row.query_length ?? 0);
    return { row, start: projected.start, end: projected.end, strand: gene.strand };
  });

  let queryGenes: QueryGene[] | null = null;
  if (queryRecord) {
    // Per-gene tallies come from every hit, not just the drawn ones.
    const perGene = await prisma.$queryRaw<Array<{
      query_id: string | null; hits: bigint; bgcs: bigint; best: string;
    }>>(Prisma.sql`
      SELECT query_id, count(*) AS hits, count(DISTINCT bgc_id) AS bgcs, max(bit_score)::text AS best
      FROM sequence_search_results
      WHERE session_id = ${sessionId}
      GROUP BY query_id
    `);
    const statsByTag = new Map(perGene.map((r) => [r.query_id ?? '', r]));

    queryGenes = queryRecord.cdsFeatures.map((cds) => {
      const stats = statsByTag.get(cds.locusTag);
      return {
        locusTag: cds.locusTag,
        start: cds.start,
        end: cds.end,
        strand: cds.strand,
        isCore: cds.isCore,
        geneKind: cds.geneKind,
        product: cds.product,
        hits: stats ? Number(stats.hits) : 0,
        bgcs: stats ? Number(stats.bgcs) : 0,
        bestBitScore: stats ? parseFloat(stats.best) : 0,
        truncated: truncatedQueries.has(cds.locusTag),
      };
    });
  }

  return {
    queryGenes,
    queries: queryRecord
      ? [{ queryId: queryRecord.locus, length: queryRecord.length, hits: totalHits }]
      : queryRows.map((row) => ({
          queryId: row.query_id,
          length: row.length,
          hits: Number(row.hits),
        })),
    loci: lociRows.map((row) => ({
      contig: queryRecord ? queryRecord.locus : row.query_id,
      queryId: row.query_id,
      start: row.start,
      end: row.end,
      strand: row.minus ? '-' : '+',
      hits: Number(row.hits),
      bgcs: Number(row.bgcs),
      avgIdentity: parseFloat(row.avg_identity),
      bestBitScore: parseFloat(row.best_bit_score),
      truncated: truncatedQueries.has(row.query_id ?? ''),
    })),
    hits: placedHits.map(({ row, start, end, strand }) => ({
      contig: queryRecord ? queryRecord.locus : row.query_id,
      groupKey: row.group_key,
      queryId: row.query_id,
      start,
      end,
      strand,
      identity: parseFloat(row.identity),
      bitScore: parseFloat(row.bit_score),
      bgcId: row.bgc_id,
      bgcFilename: row.bgc_filename,
      cdsLabel: parseTargetId(row.target_id ?? '').cdsLabel,
    })),
    shownGroups: new Set(hitRows.map((row) => row.group_key)).size,
    totalGroups,
    totalHits,
  };
}
