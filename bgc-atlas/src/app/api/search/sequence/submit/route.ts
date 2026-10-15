import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { validateFastaSequence, calculateSequenceHash, normalizeToFasta, LENGTH_BOUNDS, MAX_SEQUENCES } from '@/lib/seqsearch/fasta';
import { cdsFasta, looksLikeGenbank, originFasta, parseGenbank, selectSearchableCds } from '@/lib/seqsearch/genbank';
import { storeSearchSession, checkDuplicateSearch } from '@/lib/seqsearch/database';
import { SEARCH_DEFAULTS, thresholdOrDefault } from '@/lib/seqsearch/defaults';
import { addSearchJob, type SequenceSearchJob } from '@/lib/queue';
import { getClientIp } from '@/lib/rate-limit';
import { chargeSearchSubmission, refundSearchSubmission } from '@/lib/search-submission-limit';
import { serverError } from '@/lib/api/errors';

interface SequenceSearchRequest {
  sequence: string;
  sequenceType?: 'auto' | 'dna' | 'protein';
  /** GenBank only: search CDS translations (default) or the record's nucleotides. */
  queryMode?: 'cds' | 'contig';
  algorithm?: 'diamond';
  eValue?: string;
  minIdentity?: number;
  minCoverage?: number;
  maxResults?: number;
}

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

    let requestData: SequenceSearchRequest;

    const contentType = request.headers.get('content-type');
    if (contentType?.includes('multipart/form-data')) {
      const formData = await request.formData();
      requestData = {
        sequence: formData.get('sequence') as string,
        sequenceType: (formData.get('sequenceType') as 'auto' | 'dna' | 'protein') || 'auto',
        queryMode: (formData.get('queryMode') as 'cds' | 'contig') || undefined,
        algorithm: (formData.get('algorithm') as 'diamond') || 'diamond',
        eValue: formData.get('eValue') as string | undefined,
        minIdentity: formData.get('minIdentity') ? Number(formData.get('minIdentity')) : undefined,
        minCoverage: formData.get('minCoverage') ? Number(formData.get('minCoverage')) : undefined,
        maxResults: formData.get('maxResults') ? Number(formData.get('maxResults')) : undefined,
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

    if (!sequence || !sequence.trim()) {
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

      const detectedType = validation.sequenceType === 'nucleotide' ? 'dna' : 'protein';
      if (actualSequenceType !== detectedType) {
        console.warn(`Sequence type mismatch: specified ${actualSequenceType}, detected ${detectedType}`);
      }
    }

    if (validation.sequences.length > MAX_SEQUENCES_PER_SUBMISSION) {
      return NextResponse.json({
        success: false,
        error: `Too many sequences (${validation.sequences.length}). Maximum ${MAX_SEQUENCES_PER_SUBMISSION} sequences allowed per submission.`,
      }, { status: 400 });
    }

    const sequenceHash = calculateSequenceHash(fasta);

    const duplicateSessionId = await checkDuplicateSearch(sequenceHash, 24);
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

    // These values are stored and handed to DIAMOND as-is; the worker must not re-default them.
    const parameters = {
      algorithm: 'diamond' as const,
      sequenceType: actualSequenceType,
      eValue: eValue || SEARCH_DEFAULTS.eValue,
      identity: thresholdOrDefault(minIdentity, SEARCH_DEFAULTS.identity),
      coverage: thresholdOrDefault(minCoverage, SEARCH_DEFAULTS.coverage),
      maxResults: maxResults !== undefined ? maxResults : SEARCH_DEFAULTS.maxResults,
    };

    if (parameters.identity < 0 || parameters.identity > 100) {
      return NextResponse.json({
        success: false,
        error: 'Identity must be between 0 and 100',
      }, { status: 400 });
    }

    if (parameters.coverage < 0 || parameters.coverage > 100) {
      return NextResponse.json({
        success: false,
        error: 'Coverage must be between 0 and 100',
      }, { status: 400 });
    }

    if (parameters.maxResults < 1 || parameters.maxResults > 1000) {
      return NextResponse.json({
        success: false,
        error: 'Max results must be between 1 and 1,000',
      }, { status: 400 });
    }

    const jobData: SequenceSearchJob = {
      type: 'sequence',
      sessionId,
      sessionDir,
      fastaFile,
      parameters,
    };

    const job = await addSearchJob(jobData);
    queued = true;
    const jobId = job.id || '';

    console.log(`Created search job ${jobId} for session ${sessionId}`);

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
