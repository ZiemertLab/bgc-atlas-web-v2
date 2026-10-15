import archiver from 'archiver';
import { createWriteStream } from 'fs';

import {
  openCombinedArchive,
  type CombinedArchiveReader,
} from '@/lib/bgc-download/combined-archive';
import { readRegionGbk, RegionBusyError } from '@/lib/bgc-download/read-region';
import type { ExportRegion } from './region-sources';

// Regions come from the combined archive by offset when possible, else from the run tarball
// (bounded by readRegionGbk's box-wide tar limit). An unreadable region is counted missing and the
// export carries on.

const BUSY_RETRY_MS = 2000;
const BUSY_MAX_WAIT_MS = 10 * 60 * 1000;
const READS_AT_ONCE = 4;
/** By time, not region count: slow MFD regions (~23 s each) froze the job page for minutes. */
export const PROGRESS_EVERY_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Reader = typeof readRegionGbk;
type OpenCombined = () => Promise<CombinedArchiveReader>;

async function readWhenFree(region: ExportRegion, read: Reader, retryMs: number): Promise<Buffer> {
  const deadline = Date.now() + BUSY_MAX_WAIT_MS;
  for (;;) {
    try {
      return await read(region);
    } catch (error) {
      if (!(error instanceof RegionBusyError) || Date.now() > deadline) throw error;
      await sleep(retryMs);
    }
  }
}

export const zipEntryName = (filename: string) => (filename.endsWith('.gbk') ? filename : `${filename}.gbk`);

export interface RegionZipResult {
  missingFiles: number;
  totalSize: number;
  /** How many regions came from the combined archive, and how many from run tarballs. */
  fromCombined: number;
  fromRuns: number;
}

export async function createRegionZip(
  regions: ExportRegion[],
  outputPath: string,
  onProgress?: (processed: number) => Promise<void>,
  read: Reader = readRegionGbk,
  retryMs: number = BUSY_RETRY_MS,
  openCombined: OpenCombined = () => openCombinedArchive(),
): Promise<RegionZipResult> {
  const output = createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const closed = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  let combined: CombinedArchiveReader | null = null;
  if (regions.some((r) => r.gbkOffset != null)) {
    try {
      combined = await openCombined();
    } catch (error) {
      console.warn('GBK export: combined archive unavailable, reading run tarballs:',
        error instanceof Error ? error.message : error);
    }
  }

  let fromCombined = 0;
  let fromRuns = 0;
  const readOne = async (region: ExportRegion): Promise<Buffer> => {
    if (combined && region.gbkOffset != null && region.gbkLength != null) {
      try {
        const gbk = await combined.read(region.bgcId, region.gbkOffset, region.gbkLength);
        fromCombined += 1;
        return gbk;
      } catch (error) {
        console.warn(`GBK export: ${region.bgcId} not in the combined archive at its offset, `
          + 'reading its run tarball:', error instanceof Error ? error.message : error);
      }
    }
    const gbk = await readWhenFree(region, read, retryMs);
    fromRuns += 1;
    return gbk;
  };

  let missingFiles = 0;
  let processed = 0;
  let lastProgress = Date.now();
  try {
    for (let i = 0; i < regions.length; i += READS_AT_ONCE) {
      const slice = regions.slice(i, i + READS_AT_ONCE);
      const results = await Promise.allSettled(slice.map(readOne));
      results.forEach((result, j) => {
        const region = slice[j];
        if (result.status === 'fulfilled') {
          archive.append(result.value, { name: zipEntryName(region.filename) });
        } else {
          missingFiles += 1;
          console.warn(`GBK export: ${region.bgcId} (${region.filename}) not packaged:`,
            result.reason instanceof Error ? result.reason.message : result.reason);
        }
      });
      processed += slice.length;
      if (onProgress && Date.now() - lastProgress >= PROGRESS_EVERY_MS) {
        lastProgress = Date.now();
        await onProgress(processed);
      }
    }
    if (onProgress) await onProgress(processed);
    await archive.finalize();
  } catch (error) {
    archive.abort();
    throw error;
  } finally {
    await combined?.close().catch(() => {});
  }
  await closed;
  return { missingFiles, totalSize: archive.pointer(), fromCombined, fromRuns };
}
