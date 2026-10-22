import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { validateFastaSequence, calculateSequenceHash, normalizeToFasta, LENGTH_BOUNDS, MAX_SEQUENCES } from '@/lib/seqsearch/fasta';
import {
  cdsFasta, countGenbankRecords, looksLikeGenbank, originFasta, parseGenbank, selectSearchableCds,
} from '@/lib/seqsearch/genbank';
import { storeSearchSession, checkDuplicateSearch } from '@/lib/seqsearch/database';
import { parseSearchParameters } from '@/lib/seqsearch/defaults';
import { enqueueRecordedSearch, type SequenceSearchJob } from '@/lib/queue';
import { getClientIp } from '@/lib/rate-limit';
import { chargeSearchSubmission, refundSearchSubmission } from '@/lib/search-submission-limit';
import { serverError } from '@/lib/api/errors';

interface SequenceSearchRequest {
  sequence: string;
  sequenceType?: 'auto' | 'dna' | 'protein';
  /** GenBank only: search CDS translations (default) or the record's nucleotides. */
  queryMode?: 'cds' | 'contig';
  algorithm?: 'diamond';
  // Typed loosely on purpose: a JSON body can put anything here, and parseSearchParameters
  // is what turns them into numbers.
  eValue?: unknown;
  minIdentity?: unknown;
  minCoverage?: unknown;
  maxResults?: unknown;
}

const SEQUENCE_TYPES: readonly string[] = ['auto', 'dna', 'protein'];

interface SequenceSearchResponse {
  success: boolean;
  sessionId?: string;
  jobId?: string;
  estimatedTimeSeconds?: number;
  error?: string;
  duplicateSession?: string;
  /** GenBank input only: which part of the record was searched. */
  queryMode?: 'cds' | 'contig';
  /** Set when a GenBank CDS search fell back to the nucleotides. */
  notice?: string;
}

const SESSION_DIR = process.env.SESSION_DIR || '/tmp/sessions';
const MAX_SEQUENCES_PER_SUBMISSION = 100;
/**
 * Room for a whole annotated genome in GenBank CDS mode (a large Streptomyces .gbk with
 * translations is ~20-30 MB). FASTA input tops out near 3 MB (100 x 30 kb).
 */
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse<SequenceSearchResponse>> {
  // Only a queued search keeps its slot; see searchRateLimit.
  let chargedIp: string | null = null;
  let queued = false;
  try {
    const clientIp = getClientIp(request);
    console.log(`Sequence search submission from IP: ${clientIp}`);

    const limited = await chargeSearchSubmission(request, clientIp);
    if (limited) return limited;
    chargedIp = clientIp;

    // Checked before the body is read: request.json() and formData() hold all of it
    // in memory, and this route is outside middleware. A reverse proxy that buffers
    // the body always sends Content-Length; it is not required, so a local caller
    // without one still works.
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({
        success: false,
        error: `The submission is too large (${(contentLength / 1024 / 1024).toFixed(1)} MB). The limit is ${MAX_REQUEST_BYTES / 1024 / 1024} MB.`,
      }, { status: 413 });
    }
    let requestData: SequenceSearchRequest;

    const contentType = request.headers.get('content-type');
    if (contentType?.includes('multipart/form-data')) {
      const formData = await request.formData();
      requestData = {
        sequence: formData.get('sequence') as string,
        sequenceType: (formData.get('sequenceType') as 'auto' | 'dna' | 'protein') || 'auto',
        queryMode: (formData.get('queryMode') as 'cds' | 'contig') || undefined,
        algorithm: (formData.get('algorithm') as 'diamond') || 'diamond',
        // Raw strings; parseSearchParameters below decides what is a number.
        eValue: formData.get('eValue') ?? undefined,
        minIdentity: formData.get('minIdentity') ?? undefined,
        minCoverage: formData.get('minCoverage') ?? undefined,
        maxResults: formData.get('maxResults') ?? undefined,
      };
    } else {
      requestData = await request.json();
    }

    const { sequence, sequenceType = 'auto', algorithm = 'diamond', eValue, minIdentity, minCoverage, maxResults } = requestData;

    // DIAMOND is the only engine; MMseqs2's index could not be read from CephFS fast enough.
    if (algorithm !== 'diamond') {
      return NextResponse.json({
        success: false,
        error: `Unsupported search engine "${algorithm}". DIAMOND is the only available engine.`,
      }, { status: 400 });
    }

    if (!SEQUENCE_TYPES.includes(sequenceType)) {
      return NextResponse.json({
        success: false,
        error: 'sequenceType must be one of auto, dna or protein',
      }, { status: 400 });
    }

    if (requestData.queryMode !== undefined && requestData.queryMode !== 'cds' && requestData.queryMode !== 'contig') {
      return NextResponse.json({
        success: false,
        error: 'queryMode must be cds or contig',
      }, { status: 400 });
    }

    // Before anything is written or queued: these values reach DIAMOND's command line.
    const parsed = parseSearchParameters({ eValue, minIdentity, minCoverage, maxResults });
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }

    if (typeof sequence !== 'string' || !sequence.trim()) {
      return NextResponse.json({
        success: false,
        error: 'Sequence is required',
      }, { status: 400 });
    }

    // GenBank is converted to FASTA first, so the rest of the pipeline is unchanged.
    // CDS mode searches the record's stated translations (exact gene boundaries).
    let queryText = sequence;
    let genbankMode: 'cds' | 'contig' | null = null;
    let genbankNote: string | undefined;

    if (looksLikeGenbank(sequence)) {
      // One record only: the parser reads the first, and searching contig 1 of a
      // 120-contig genome while reporting it as "the file" answers a different question.
      const records = countGenbankRecords(sequence);
      if (records > 1) {
        return NextResponse.json({
          success: false,
          error: `This GenBank file has ${records.toLocaleString('en-US')} records; sequence search reads one. `
            + 'Upload the region or record you want to search (e.g. an antiSMASH regionNNN.gbk), '
            + 'or paste its sequences as FASTA.',
        }, { status: 400 });
      }
      const record = parseGenbank(sequence);
      if (!record) {
        return NextResponse.json({
          success: false,
          error: 'This looks like a GenBank file but could not be parsed.',
        }, { status: 400 });
      }

      // Length limits apply per CDS, so unusable genes are skipped, not fatal.
      const selection = selectSearchableCds(record, LENGTH_BOUNDS.protein, MAX_SEQUENCES);
      const translated = cdsFasta(record, selection.selected);
      const nucleotides = originFasta(record);
      const wantsCds = (requestData.queryMode ?? 'cds') === 'cds';

      if (wantsCds && translated) {
        queryText = translated;
        genbankMode = 'cds';

        const skipped: string[] = [];
        if (selection.tooShort.length) {
          skipped.push(
            `${selection.tooShort.length} shorter than ${LENGTH_BOUNDS.protein.min} aa`
          );
        }
        if (selection.tooLong.length) {
          skipped.push(
            `${selection.tooLong.length} longer than ${LENGTH_BOUNDS.protein.max.toLocaleString()} aa`
          );
        }
        if (selection.overLimit.length) {
          skipped.push(
            `${selection.overLimit.length} beyond the ${MAX_SEQUENCES}-sequence limit ` +
            '(core biosynthetic genes and the longest proteins were kept)'
          );
        }
        if (skipped.length) {
          genbankNote =
            `Searching ${selection.selected.length} of ${record.cdsFeatures.length} CDS features — ` +
            `skipped ${skipped.join('; ')}.`;
        }
      } else if (nucleotides) {
        queryText = nucleotides;
        genbankMode = 'contig';
        // Worth saying: the search becomes blastx and the map loses its gene track.
        if (wantsCds) {
          genbankNote =
            record.cdsFeatures.length === 0
              ? 'No CDS features in the file, so its nucleotide sequence was searched instead.'
              : 'No CDS carried a /translation, so the nucleotide sequence was searched instead.';
        }
      } else {
        return NextResponse.json({
          success: false,
          error: translated
            ? 'The file has no ORIGIN sequence to search.'
            : 'The file has neither CDS translations nor an ORIGIN sequence to search.',
        }, { status: 400 });
      }
    }

    // Normalised once so the validated text, hash, DIAMOND's file and the stored
    // record are identical (a bare pasted sequence gets a header).
    const fasta = normalizeToFasta(queryText);

    const validation = validateFastaSequence(fasta);
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        error: validation.error || 'Invalid FASTA format',
      }, { status: 400 });
    }

    let actualSequenceType: 'dna' | 'protein';
    if (genbankMode) {
      actualSequenceType = genbankMode === 'cds' ? 'protein' : 'dna';
    } else if (sequenceType === 'auto') {
      actualSequenceType = validation.sequenceType === 'nucleotide' ? 'dna' : 'protein';
    } else {
      actualSequenceType = sequenceType;

      // The chosen alphabet must match the sequence: DNA through blastp, or protein
      // through blastx, would spend a queue slot on a meaningless answer.
      const detectedType = validation.sequenceType === 'nucleotide' ? 'dna' : 'protein';
      if (actualSequenceType !== detectedType) {
        const name = (t: 'dna' | 'protein') => (t === 'dna' ? 'nucleotide' : 'protein');
        return NextResponse.json({
          success: false,
          error: `You chose ${name(actualSequenceType)}, but this looks like a ${name(detectedType)} sequence. `
            + 'Choose Auto-detect, or the matching sequence type.',
        }, { status: 400 });
      }
    }

    if (validation.sequences.length > MAX_SEQUENCES_PER_SUBMISSION) {
      return NextResponse.json({
        success: false,
        error: `Too many sequences (${validation.sequences.length}). Maximum ${MAX_SEQUENCES_PER_SUBMISSION} sequences allowed per submission.`,
      }, { status: 400 });
    }

    const sequenceHash = calculateSequenceHash(fasta);

    // Same sequence AND same parameters: a resubmission at other thresholds is a
    // different search, and is run.
    const duplicateSessionId = await checkDuplicateSearch(sequenceHash, {
      sequenceType: actualSequenceType === 'dna' ? 'nucleotide' : 'protein',
      eValue: parseFloat(parsed.value.eValue),
      minIdentity: parsed.value.identity,
      minCoverage: parsed.value.coverage,
      maxResults: parsed.value.maxResults,
    }, 24);
    if (duplicateSessionId) {
      console.log(`Found duplicate search for hash ${sequenceHash}: ${duplicateSessionId}`);
      return NextResponse.json({
        success: true,
        sessionId: duplicateSessionId,
        duplicateSession: duplicateSessionId,
      });
    }

    const sessionId = uuidv4();
    const sessionDir = join(SESSION_DIR, sessionId);

    await mkdir(sessionDir, { recursive: true });
    console.log(`Created session directory: ${sessionDir}`);

    const fastaFile = join(sessionDir, 'query.fasta');
    await writeFile(fastaFile, fasta);
    console.log(`Wrote FASTA file: ${fastaFile}`);

    // These values are stored and handed to DIAMOND as-is (every fallback happens in
    // parseSearchParameters); the worker must not re-default them.
    const parameters = {
      algorithm: 'diamond' as const,
      sequenceType: actualSequenceType,
      ...parsed.value,
    };

    const jobData: SequenceSearchJob = {
      type: 'sequence',
      sessionId,
      sessionDir,
      fastaFile,
      parameters,
    };

    // The record before the job, which is queued under the session's id: see
    // enqueueRecordedSearch.
    const jobId = sessionId;
    const userAgent = request.headers.get('user-agent') || undefined;
    await storeSearchSession({
      sessionId,
      // The original GenBank record: the contig map reads the query's CDS layout from it.
      inputSequence: genbankMode ? sequence : fasta,
      sequenceHash,
      sequenceType: actualSequenceType === 'dna' ? 'nucleotide' : 'protein',
      parameters: {
        algorithm: algorithm,
        eValue: parseFloat(parameters.eValue),
        minIdentity: parameters.identity,
        minCoverage: parameters.coverage,
        maxResults: parameters.maxResults,
      },
      jobId,
      ipAddress: clientIp !== 'unknown' ? clientIp : undefined,
      userAgent,
    });

    await enqueueRecordedSearch(jobData);
    queued = true;
    console.log(`Created search job for session ${sessionId}`);

    const totalSequenceLength = validation.sequences.reduce((sum, seq) => sum + seq.length, 0);
    // Rough estimate: 5 s per 1000 residues, tripled for blastx's six-frame translation.
    const estimatedTimeSeconds =
      Math.ceil(totalSequenceLength / 1000) * 5 * (actualSequenceType === 'dna' ? 3 : 1);

    return NextResponse.json({
      success: true,
      ...(genbankMode ? { queryMode: genbankMode } : {}),
      ...(genbankNote ? { notice: genbankNote } : {}),
      sessionId,
      jobId,
      estimatedTimeSeconds,
    });

  } catch (error) {
    return serverError(error, 'Error submitting sequence search');
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
