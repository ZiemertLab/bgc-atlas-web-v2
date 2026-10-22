import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis-client';
import { writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  formatFileSize,
  hasValidGenbankExtension,
  sanitizeFilename,
  toBigSliceQueryFilename,
} from '@/lib/bigslice/validation';
import { GenbankUsabilityScanner, bigSliceUnusableMessage } from '@/lib/bigslice/genbank-usability';
import {
  storeBigSliceSession,
  checkDuplicateBigSliceSearch
} from '@/lib/bigslice/database';
import { getClientIp } from '@/lib/rate-limit';
import { chargeSearchSubmission, refundSearchSubmission } from '@/lib/search-submission-limit';
import { enqueueRecordedSearch, type BGCSearchJob } from '@/lib/queue';
import { CLUSTERING_THRESHOLD } from '@/lib/bigslice/families';
import { serverError, UserFacingError } from '@/lib/api/errors';
import { receiveMultipart, type FileInspector, type ReceivedUpload } from '@/lib/contribute/multipart';
import {
  BIGSLICE_MAX_FILE_BYTES, BIGSLICE_MAX_FILES, BIGSLICE_MAX_TOTAL_BYTES, BIGSLICE_MULTIPART_OVERHEAD_BYTES,
} from '@/lib/bigslice/upload-limits';

interface BigSliceSubmitResponse {
  success: boolean;
  sessionId?: string;
  jobId?: string;
  estimatedTimeSeconds?: number;
  error?: string;
  duplicateSession?: string;
}

const SESSION_DIR = process.env.BIGSLICE_SESSION_DIR || '/data/bgc-atlas/data-v2/bigslice/sessions';
// Shared with the search page; see lib/bigslice/upload-limits.ts for why the total
// is 490 MB.
const MAX_FILES_PER_SUBMISSION = BIGSLICE_MAX_FILES;
const MAX_TOTAL_FILE_SIZE_BYTES = BIGSLICE_MAX_TOTAL_BYTES;
const MAX_FILE_SIZE_BYTES = BIGSLICE_MAX_FILE_BYTES;
const MAX_MULTIPART_OVERHEAD_BYTES = BIGSLICE_MULTIPART_OVERHEAD_BYTES;
const ALLOWED_FILE_TYPES = new Set([
  '',
  'application/octet-stream',
  'chemical/x-genbank',
  'application/x-genbank',
  'text/plain',
  'text/x-genbank',
]);

interface SavedGenbankFile {
  originalName: string;
  queryName: string;
  path: string;
  size: number;
  sha256: string;
}

function parseContentLength(request: NextRequest): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validateUploadEnvelope(request: NextRequest): NextResponse<BigSliceSubmitResponse> | null {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({
      success: false,
      error: 'Expected multipart/form-data upload.',
    }, { status: 415 });
  }

  const contentLength = parseContentLength(request);
  if (contentLength === null) {
    return NextResponse.json({
      success: false,
      error: 'Content-Length header is required for uploads.',
    }, { status: 411 });
  }

  const maxRequestBytes = MAX_TOTAL_FILE_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
  if (contentLength > maxRequestBytes) {
    return NextResponse.json({
      success: false,
      error: `Upload request is too large. Maximum request size is ${formatFileSize(maxRequestBytes)}.`,
    }, { status: 413 });
  }

  return null;
}

/** Refuse a part by its name and declared type, before a byte of it is stored. */
function checkGenbankPart(filename: string, mimeType: string): string | null {
  if (!hasValidGenbankExtension(filename)) {
    return `File '${filename}' must use a GenBank extension (.gbk, .genbank, .gbff, .gb).`;
  }
  if (!ALLOWED_FILE_TYPES.has(mimeType)) {
    return `File '${filename}' has unsupported content type '${mimeType}'.`;
  }
  return null;
}

/**
 * The per-file checks that need the content, run as the file streams to disk:
 * its hash, whether it is GenBank at all (and if not, what it is), and whether
 * BiG-SLiCE would find a BGC in it. `finish` throws the reader's message.
 */
function genbankInspector(filename: string): FileInspector {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let scanTail = '';
  let hasLocus = false;
  let hasFeatures = false;
  let hasOrigin = false;
  const usability = new GenbankUsabilityScanner();
  /** The file's opening characters, to name the format when it is not GenBank. */
  let head = '';

  return {
    push(chunk: Buffer) {
      hash.update(chunk);
      const decoded = decoder.decode(chunk, { stream: true });
      usability.push(decoded);
      if (head.length < 16) head += decoded.slice(0, 16);
      const text = scanTail + decoded;
      hasLocus ||= /^LOCUS\s+/m.test(text);
      hasFeatures ||= /^FEATURES\s+/m.test(text);
      hasOrigin ||= /^ORIGIN\s+/m.test(text);
      scanTail = text.slice(-8192);
    },
    finish(bytes: number): { sha256: string } {
      const rest = decoder.decode();
      usability.push(rest);
      const flush = scanTail + rest;
      hasLocus ||= /^LOCUS\s+/m.test(flush);
      hasFeatures ||= /^FEATURES\s+/m.test(flush);
      hasOrigin ||= /^ORIGIN\s+/m.test(flush);

      if (bytes === 0) {
        throw new UserFacingError(`File '${filename}' is empty.`);
      }
      if (!hasLocus) {
        // Both turn up among real uploads: FASTA saved under a .gbk name, and EMBL flat files.
        const opening = head.trimStart();
        if (opening.startsWith('>')) {
          throw new UserFacingError(
            `File '${filename}' is FASTA, not GenBank. To search a sequence, use Sequence similarity.`,
          );
        }
        if (/^ID {3}/.test(opening)) {
          throw new UserFacingError(
            `File '${filename}' is in EMBL format. BiG-SLiCE reads GenBank as antiSMASH writes it (regionNNN.gbk).`,
          );
        }
        throw new UserFacingError(`File '${filename}' is missing the required LOCUS header.`);
      }
      // Rejecting here rather than letting BiG-SLiCE skip the file: a query whose files
      // yield no BGC fails outright, and one that skips some of them returns results for
      // the rest without saying so. Either way the reader learns nothing about the file.
      const verdict = usability.finish();
      if (!verdict.usable) {
        throw new UserFacingError(bigSliceUnusableMessage(filename, verdict.reason));
      }
      if (!hasFeatures || !hasOrigin) {
        console.warn(
          `GenBank file '${filename}' is missing recommended sections:`,
          !hasFeatures ? 'FEATURES' : '',
          !hasOrigin ? 'ORIGIN' : ''
        );
      }
      return { sha256: hash.digest('hex') };
    },
  };
}

function calculateFileHashSetHash(files: SavedGenbankFile[]): string {
  const hash = createHash('sha256');
  for (const fileHash of files.map((file) => file.sha256).sort()) {
    hash.update(fileHash);
  }
  return hash.digest('hex');
}

/**
 * Paused while the family clustering is being replaced: between the cutover and the
 * rebuild of the centroid caches, a search would match the OLD clustering's families
 * and name them as new ones. Switched at runtime like the site notice:
 *   redis-cli SET site:bigslice-paused 1   /   redis-cli DEL site:bigslice-paused
 * An unreachable Redis means not paused.
 */
async function bigsliceSearchPaused(): Promise<boolean> {
  try {
    return Boolean(await redis.get('site:bigslice-paused'));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<BigSliceSubmitResponse>> {
  if (await bigsliceSearchPaused()) {
    return NextResponse.json(
      {
        success: false,
        error: 'BGC clustering search is paused while the gene cluster families are being updated. ' +
          'That usually takes a few hours; please check again in an hour.',
      },
      // Matches the text: check back hourly. It said "a few hours" beside a one-hour
      // Retry-After, so a script and a person were told two different things.
      { status: 503, headers: { 'Retry-After': '3600' } },
    );
  }
  // Only a queued search keeps its slot; see searchRateLimit.
  let chargedIp: string | null = null;
  let queued = false;
  try {
    const clientIp = getClientIp(request);
    console.log(`BiG-SLiCE search submission from IP: ${clientIp}`);

    const limited = await chargeSearchSubmission(request, clientIp);
    if (limited) return limited;
    chargedIp = clientIp;

    const envelopeError = validateUploadEnvelope(request);
    if (envelopeError) return envelopeError;

    // Not a user parameter: query mode ignores `--threshold`, and 0.4 is what
    // both clustering models were built at. Recorded per session.
    const distanceThreshold = CLUSTERING_THRESHOLD;

    // Streamed to disk as it arrives (lib/contribute/multipart.ts), not held in
    // memory. Each file is checked by name and type before it is stored and by
    // content as it streams; the first refusal stops the read.
    const sessionId = uuidv4();
    const sessionDir = join(SESSION_DIR, sessionId);
    const existingFilenames = new Set<string>();
    const queryNameFor = (filename: string) => {
      const queryName = toBigSliceQueryFilename(sanitizeFilename(filename), existingFilenames.size, existingFilenames);
      existingFilenames.add(queryName);
      return queryName;
    };

    let upload: ReceivedUpload;
    try {
      upload = await receiveMultipart(request, {
        dir: sessionDir,
        files: {
          files: {
            maxCount: MAX_FILES_PER_SUBMISSION,
            tooMany: (count) => `Too many files (${count}). Maximum ${MAX_FILES_PER_SUBMISSION} files allowed.`,
            maxBytes: MAX_FILE_SIZE_BYTES,
            tooLarge: (filename) =>
              `File '${filename}' is too large. Maximum per-file size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`,
            check: checkGenbankPart,
            inspect: genbankInspector,
          },
        },
        safeName: queryNameFor,
        maxTotalBytes: MAX_TOTAL_FILE_SIZE_BYTES,
        tooLargeTotal: `Total upload size is too large. Maximum total size is ${formatFileSize(MAX_TOTAL_FILE_SIZE_BYTES)}.`,
      });
    } catch (error) {
      await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      // UserFacingError messages reach the reader as 4xx; write failures are logged.
      return serverError(error, 'Saving BiG-SLiCE upload');
    }

    if (upload.files.length === 0) {
      await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      return NextResponse.json({
        success: false,
        error: 'No files provided. Please upload at least one GenBank file.',
      }, { status: 400 });
    }

    // renamed -> the name the reader sees. Results are grouped, labelled and cascaded by
    // that name, so two uploads that share one (region001.gbk from two folders, which the
    // page allows) merged into a single group and the second was never sent to the
    // fragmented model. A repeat gets a counter: "region001.gbk (2)".
    const filenameMap: Record<string, string> = {};
    const shown = new Set<string>();
    const displayName = (name: string) => {
      let candidate = name;
      for (let n = 2; shown.has(candidate); n += 1) candidate = `${name} (${n})`;
      shown.add(candidate);
      return candidate;
    };
    const savedUploads: SavedGenbankFile[] = upload.files.map((file) => {
      filenameMap[file.savedName] = displayName(file.filename);
      console.log(`Saved GenBank file: ${join(sessionDir, file.savedName)} (original: ${file.filename})`);
      return {
        originalName: file.filename,
        queryName: file.savedName,
        path: join(sessionDir, file.savedName),
        size: file.bytes,
        sha256: (file.inspection as { sha256: string }).sha256,
      };
    });

    const sessionHash = calculateFileHashSetHash(savedUploads);

    const duplicateSessionId = await checkDuplicateBigSliceSearch(sessionHash, 24);
    if (duplicateSessionId) {
      console.log(`Found duplicate BiG-SLiCE search for hash ${sessionHash}: ${duplicateSessionId}`);
      await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      return NextResponse.json({
        success: true,
        sessionId: duplicateSessionId,
        duplicateSession: duplicateSessionId,
      });
    }

    const savedFiles = savedUploads.map((file) => file.path);

    // renamed -> original upload name, for result display
    await writeFile(
      join(sessionDir, 'filename_map.json'),
      JSON.stringify(filenameMap, null, 2)
    );

    const jobData: BGCSearchJob = {
      type: 'bgc',
      sessionId,
      sessionDir,
      genbankFiles: savedFiles,
      parameters: {
        algorithm: 'bigslice',
        distanceThreshold,
      },
    };

    // The record before the job, which is queued under the session's id: see
    // enqueueRecordedSearch.
    const jobId = sessionId;
    const userAgent = request.headers.get('user-agent') || undefined;
    await storeBigSliceSession({
      sessionId,
      sessionHash,
      numFiles: savedUploads.length,
      totalFileSizeBytes: savedUploads.reduce((sum, file) => sum + file.size, 0),
      distanceThreshold,
      jobId,
      ipAddress: clientIp !== 'unknown' ? clientIp : undefined,
      userAgent,
    });

    await enqueueRecordedSearch(jobData);
    queued = true;
    console.log(`Created BiG-SLiCE search job for session ${sessionId}`);

    // Rough estimate: 30 seconds per BGC
    const estimatedTimeSeconds = savedUploads.length * 30;

    return NextResponse.json({
      success: true,
      sessionId,
      jobId,
      estimatedTimeSeconds,
    });

  } catch (error) {
    return serverError(error, 'Error submitting BiG-SLiCE search');
  } finally {
    if (chargedIp !== null && !queued) await refundSearchSubmission(chargedIp);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
