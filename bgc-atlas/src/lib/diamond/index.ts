import { spawn } from 'child_process';
import { access, mkdir, readFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { buildSeqSearchCommand, checkSeqSearchAvailability, seqSearchThreads } from '@/lib/seqsearch/exec';
import type { SeqSearchHit } from '@/lib/seqsearch/types';
import { expandBtop } from '@/lib/seqsearch/alignment';
import { computeCoverages } from './coverage';
import { buildDiamondArgs } from './args';

export interface DiamondOptions {
  queryFile: string;
  outputDirectory: string;
  // Selects the alignment mode: protein queries use blastp, nucleotide queries use blastx
  // (six-frame translation against the same protein DB — there is no nucleotide DB).
  sequenceType?: 'nucleotide' | 'protein';
  eValue?: number;          // E-value threshold (default: 1e-5)
  minIdentity?: number;     // Min identity % (default: 30)
  minCoverage?: number;     // Min coverage % (default: 50)
  maxResults?: number;      // Max hits to return (default: 1000)
  threads?: number;         // CPU threads (default: 4)
  logFile?: string;
}

export interface DiamondResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  resultsFile: string;
}

// The persisted hit shape is engine-neutral; DIAMOND is simply the engine that fills it.
export type DiamondHit = SeqSearchHit;

export async function runDiamond(options: DiamondOptions): Promise<DiamondResult> {
  const {
    queryFile,
    outputDirectory,
    sequenceType = 'protein',
    eValue = 1e-5,
    minIdentity = 30,
    minCoverage = 50,
    maxResults = 1000,
    threads = seqSearchThreads(),
    logFile,
  } = options;

  try {
    await access(outputDirectory);
  } catch {
    await mkdir(outputDirectory, { recursive: true });
  }

  const diamondDbPath = process.env.DIAMOND_PROTEIN_DB || '/data/bgc-atlas/diamond-db/protein/bgc_proteins_db';
  const condaEnv = process.env.DIAMOND_CONDA_ENV || 'diamond';
  // Tmp under the (CephFS) session dir so it is visible to the container in ssh-docker mode.
  const tmpDir = process.env.DIAMOND_TMP_DIR || join(outputDirectory, 'diamond_tmp');

  try {
    await mkdir(tmpDir, { recursive: true });
  } catch {
    // Ignore if already exists
  }

  const resultsFile = join(outputDirectory, 'diamond_results.tsv');

  const toolArgs = buildDiamondArgs({
    sequenceType,
    queryFile,
    dbPath: diamondDbPath,
    resultsFile,
    eValue,
    minIdentity,
    minCoverage,
    maxResults,
    threads,
    tmpDir,
    blockSize: process.env.DIAMOND_BLOCK_SIZE,
  });
  const mode = sequenceType === 'nucleotide' ? 'blastx' : 'blastp';

  const dockerImage = process.env.DIAMOND_DOCKER_IMAGE || 'diamond:latest';
  const { command, args } = buildSeqSearchCommand(condaEnv, dockerImage, toolArgs);
  const commandString = `${command} ${args.join(' ')}`;
  console.log(`Executing DIAMOND ${mode}: ${commandString}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const logStream = logFile ? createWriteStream(logFile) : null;
    logStream?.write(`Executing DIAMOND: ${commandString}\n\n`);

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      logStream?.write(chunk);
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      logStream?.write(chunk);
    });

    child.on('close', (exitCode) => {
      console.log(`DIAMOND process exited with code: ${exitCode}`);
      logStream?.end();

      resolve({
        success: exitCode === 0,
        exitCode: exitCode || -1,
        stdout,
        stderr,
        command: commandString,
        resultsFile,
      });
    });

    child.on('error', (error) => {
      console.error(`DIAMOND process error:`, error);
      const errorMessage = '\n' + error.message;
      stderr += errorMessage;
      logStream?.write(errorMessage);
      logStream?.end();

      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        command: commandString,
        resultsFile,
      });
    });
  });
}

// Ungapped alignments pass straight through, which also keeps files written before btop working.
function expandAligned(qseq?: string, sseq?: string, btop?: string):
  { queryAligned?: string; targetAligned?: string } {
  if (!qseq || !sseq) return {};
  if (qseq.length === sseq.length && !/[-]/.test(btop ?? '')) {
    return { queryAligned: qseq, targetAligned: sseq };
  }
  const expanded = btop ? expandBtop(btop, qseq, sseq) : null;
  if (!expanded) return {};
  return { queryAligned: expanded.query, targetAligned: expanded.target };
}

export async function parseDiamondResults(
  tsvFile: string,
  sequenceType: 'nucleotide' | 'protein' = 'protein',
): Promise<DiamondHit[]> {
  try {
    const content = await readFile(tsvFile, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length === 0) {
      console.log('No results found in DIAMOND output');
      return [];
    }

    const hits: DiamondHit[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      const fields = line.split('\t');
      if (fields.length < 14) {
        console.warn(`Skipping malformed line: ${line}`);
        continue;
      }

      const [
        queryId,
        targetId,
        pident,
        length,
        mismatch,
        gapopen,
        qstart,
        qend,
        sstart,
        send,
        evalue,
        bitscore,
        qlen,
        slen,
        qseq,
        sseq,
        btop,
      ] = fields;

      const alignmentLength = parseInt(length, 10);
      const queryLen = parseInt(qlen, 10);
      const targetLen = parseInt(slen, 10);

      const { queryCoverage, targetCoverage } = computeCoverages(
        alignmentLength, queryLen, targetLen, sequenceType,
      );

      hits.push({
        queryId,
        targetId,
        identity: parseFloat(pident),
        alignmentLength,
        mismatches: parseInt(mismatch, 10),
        gapOpens: parseInt(gapopen, 10),
        queryStart: parseInt(qstart, 10),
        queryEnd: parseInt(qend, 10),
        targetStart: parseInt(sstart, 10),
        targetEnd: parseInt(send, 10),
        eValue: parseFloat(evalue),
        bitScore: parseFloat(bitscore),
        queryLen,
        targetLen,
        queryCoverage,
        targetCoverage,
        // Expanded through the traceback before storage so downstream code never sees BTOP.
        ...expandAligned(qseq, sseq, btop),
      });
    }

    console.log(`Parsed ${hits.length} hits from DIAMOND results`);
    return hits;

  } catch (error) {
    console.error('Error parsing DIAMOND results:', error);
    throw new Error(`Failed to parse DIAMOND results: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function checkDiamondAvailability(): Promise<boolean> {
  const condaEnv = process.env.DIAMOND_CONDA_ENV || 'diamond';
  const dockerImage = process.env.DIAMOND_DOCKER_IMAGE || 'diamond:latest';
  return checkSeqSearchAvailability(condaEnv, 'diamond', dockerImage, process.env.DIAMOND_DOCKER_PULL);
}
