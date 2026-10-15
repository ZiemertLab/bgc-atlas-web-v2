import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis-client';
import { createWriteStream } from 'fs';
import { writeFile, mkdir, rm, unlink } from 'fs/promises';
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
import { addSearchJob, type BGCSearchJob } from '@/lib/queue';
import { CLUSTERING_THRESHOLD } from '@/lib/bigslice/families';
import { serverError, UserFacingError } from '@/lib/api/errors';

interface BigSliceSubmitResponse {
  success: boolean;
  sessionId?: string;
  jobId?: string;
  estimatedTimeSeconds?: number;
  error?: string;
  duplicateSession?: string;
}

const SESSION_DIR = process.env.BIGSLICE_SESSION_DIR || '/data/bgc-atlas/data-v2/bigslice/sessions';
const MAX_FILES_PER_SUBMISSION = 100;
const MAX_TOTAL_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 10 * 1024 * 1024;
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

function validateFileMetadata(files: File[]): { error?: string; totalSize: number } {
  if (files.length === 0) {
    return { error: 'No files provided. Please upload at least one GenBank file.', totalSize: 0 };
  }

  if (files.length > MAX_FILES_PER_SUBMISSION) {
    return {
      error: `Too many files (${files.length}). Maximum ${MAX_FILES_PER_SUBMISSION} files allowed.`,
      totalSize: 0,
    };
  }

  let totalSize = 0;
  for (const file of files) {
    const filename = file.name || 'unnamed_file';
    totalSize += file.size;

    if (file.size <= 0) {
      return { error: `File '${filename}' is empty.`, totalSize };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        error: `File '${filename}' is too large. Maximum per-file size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`,
        totalSize,
      };
    }

    if (!hasValidGenbankExtension(filename)) {
      return {
        error: `File '${filename}' must use a GenBank extension (.gbk, .genbank, .gbff, .gb).`,
        totalSize,
      };
    }

    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      return {
        error: `File '${filename}' has unsupported content type '${file.type}'.`,
        totalSize,
      };
    }
  }

  if (totalSize > MAX_TOTAL_FILE_SIZE_BYTES) {
    return {
      error: `Total upload size is too large. Maximum total size is ${formatFileSize(MAX_TOTAL_FILE_SIZE_BYTES)}.`,
      totalSize,
    };
  }

  return { totalSize };
}

async function writeFileChunk(stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array) {
  const buffer = Buffer.from(chunk);
  if (!stream.write(buffer)) {
    await new Promise<void>((resolve, reject) => {
      stream.once('drain', resolve);
      stream.once('error', reject);
    });
  }
}

async function closeFileStream(stream: ReturnType<typeof createWriteStream>) {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function saveAndValidateGenbankFile(file: File, filePath: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256');
  const reader = file.stream().getReader();
  const writer = createWriteStream(filePath, { flags: 'wx' });
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let bytes = 0;
  let scanTail = '';
  let hasLocus = false;
  let hasFeatures = false;
  let hasOrigin = false;
  const usability = new GenbankUsabilityScanner();
  /** The file's opening characters, to name the format when it is not GenBank. */
  let head = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > MAX_FILE_SIZE_BYTES) {
        throw new UserFacingError(`File '${file.name}' exceeded ${formatFileSize(MAX_FILE_SIZE_BYTES)} while streaming.`);
      }

      hash.update(value);
      const decoded = decoder.decode(value, { stream: true });
      usability.push(decoded);
      if (head.length < 16) head += decoded.slice(0, 16);
      const text = scanTail + decoded;
      hasLocus ||= /^LOCUS\s+/m.test(text);
      hasFeatures ||= /^FEATURES\s+/m.test(text);
      hasOrigin ||= /^ORIGIN\s+/m.test(text);
      scanTail = text.slice(-8192);

      await writeFileChunk(writer, value);
    }

    const rest = decoder.decode();
    usability.push(rest);
    const flush = scanTail + rest;
    hasLocus ||= /^LOCUS\s+/m.test(flush);
    hasFeatures ||= /^FEATURES\s+/m.test(flush);
    hasOrigin ||= /^ORIGIN\s+/m.test(flush);

    await closeFileStream(writer);

    if (bytes === 0) {
      throw new UserFacingError(`File '${file.name}' is empty.`);
    }
    if (!hasLocus) {
      // Both turn up among real uploads: FASTA saved under a .gbk name, and EMBL flat files.
      const opening = head.trimStart();
      if (opening.startsWith('>')) {
        throw new UserFacingError(
          `File '${file.name}' is FASTA, not GenBank. To search a sequence, use Sequence similarity.`,
        );
      }
      if (/^ID {3}/.test(opening)) {
        throw new UserFacingError(
          `File '${file.name}' is in EMBL format. BiG-SLiCE reads GenBank as antiSMASH writes it (regionNNN.gbk).`,
        );
      }
      throw new UserFacingError(`File '${file.name}' is missing the required LOCUS header.`);
    }
    // Rejecting here rather than letting BiG-SLiCE skip the file: a query whose files
    // yield no BGC fails outright, and one that skips some of them returns results for
    // the rest without saying so. Either way the reader learns nothing about the file.
    const verdict = usability.finish();
    if (!verdict.usable) {
      throw new UserFacingError(bigSliceUnusableMessage(file.name, verdict.reason));
    }
    if (!hasFeatures || !hasOrigin) {
      console.warn(
        `GenBank file '${file.name}' is missing recommended sections:`,
        !hasFeatures ? 'FEATURES' : '',
        !hasOrigin ? 'ORIGIN' : ''
      );
    }

    return { size: bytes, sha256: hash.digest('hex') };
  } catch (error) {
    writer.destroy();
    await unlink(filePath).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
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
          'Please try again in a few hours.',
      },
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

    const formData = await request.formData();

    // Not a user parameter: query mode ignores `--threshold`, and 0.4 is what
    // both clustering models were built at. Recorded per session.
    const distanceThreshold = CLUSTERING_THRESHOLD;

    const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);
    const metadataValidation = validateFileMetadata(files);
    if (metadataValidation.error) {
      return NextResponse.json({
        success: false,
        error: metadataValidation.error,
      }, { status: 400 });
    }

    const sessionId = uuidv4();
    const sessionDir = join(SESSION_DIR, sessionId);
    await mkdir(sessionDir, { recursive: true });
    console.log(`Created BiG-SLiCE session directory: ${sessionDir}`);

    const existingFilenames = new Set<string>();
    const savedUploads: SavedGenbankFile[] = [];
    const filenameMap: Record<string, string> = {}; // renamed -> original

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const sanitized = sanitizeFilename(file.name);
        const queryName = toBigSliceQueryFilename(sanitized, i, existingFilenames);
        existingFilenames.add(queryName);
        filenameMap[queryName] = file.name;

        const filePath = join(sessionDir, queryName);
        const result = await saveAndValidateGenbankFile(file, filePath);
        savedUploads.push({
          originalName: file.name,
          queryName,
          path: filePath,
          size: result.size,
          sha256: result.sha256,
        });

        console.log(`Saved GenBank file: ${filePath} (original: ${file.name})`);
      }
    } catch (error) {
      await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      // UserFacingError messages reach the reader as 400s; write failures are logged.
      return serverError(error, 'Saving BiG-SLiCE upload');
    }

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

    const job = await addSearchJob(jobData);
    queued = true;
    const jobId = job.id || '';

    console.log(`Created BiG-SLiCE search job ${jobId} for session ${sessionId}`);

    const userAgent = request.headers.get('user-agent') || undefined;
    await storeBigSliceSession({
      sessionId,
      sessionHash,
      numFiles: files.length,
      totalFileSizeBytes: savedUploads.reduce((sum, file) => sum + file.size, 0),
      distanceThreshold,
      jobId,
      ipAddress: clientIp !== 'unknown' ? clientIp : undefined,
      userAgent,
    });

    // Rough estimate: 30 seconds per BGC
    const estimatedTimeSeconds = files.length * 30;

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
