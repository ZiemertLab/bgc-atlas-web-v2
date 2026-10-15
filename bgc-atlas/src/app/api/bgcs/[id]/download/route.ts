import { NextRequest, NextResponse } from 'next/server';
import { findBgcRedirect, redirectToTwin } from '@/lib/bgc/redirect';

import prisma from '@/lib/prisma';
import { checkRateLimit, DOWNLOAD_REFILL_PER_MINUTE, downloadRateLimit, getClientIp } from '@/lib/rate-limit';
import { genbankToNucleotideFasta, genbankToProteinFasta } from '@/lib/bgc-download/genbank';
import { readRegionGbk, RegionBusyError, RegionNotFoundError } from '@/lib/bgc-download/read-region';
import { downloadFilename } from '@/lib/bgc-download/region-member';
import { readCombinedRegion } from '@/lib/bgc-download/combined-archive';
import { exportRegionsByIds } from '@/lib/export/region-sources';
import { GCF_GBK_EXPORT_MAX_MEMBERS, PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS = { gbk: 'GenBank', fna: 'nucleotide FASTA', faa: 'protein FASTA' } as const;
type Format = keyof typeof FORMATS;

const fail = (status: number, error: string, headers?: Record<string, string>, extra?: object) =>
  NextResponse.json({ success: false, error, ...extra }, { status, headers });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

/**
 * Bulk alternatives, returned with a 429. Absolute URLs from SITE_URL, never
 * request.url: behind nginx that is the upstream host.
 */
const BULK_DOWNLOADS = {
  byProperty: `In a web browser, run a Property Search at ${SITE_URL}/search (product type, taxon, GCF ID, ...) and choose 'Download region GBK files': one zip of up to ${PROPERTY_GBK_EXPORT_MAX_REGIONS.toLocaleString('en-US')} matching regions.`,
  byFamily: `In a web browser, each family page (${SITE_URL}/gcfs/<gcf_id>) has a GBK export of up to ${GCF_GBK_EXPORT_MAX_MEMBERS.toLocaleString('en-US')} members.`,
  everything: `${SITE_URL}/downloads/all_regions_gbk.tar.gz (169 GB; members are named <bgc_id>.gbk; SHA-256 at the same URL + .sha256). Every bulk file is listed at ${SITE_URL}/downloads`,
  fromTheArchive: `With a local copy of the archive, ${SITE_URL}/downloads/extract_gbk.py and ${SITE_URL}/downloads/all_regions_gbk.index.tsv.gz pull out the BGCs you list without unpacking it; ${SITE_URL}/downloads/bgc_id_redirects.tsv.gz maps ids saved before 2026-10-05.`,
};

const rateHeaders = (limit: { limit: number; remaining: number; reset: number }) => ({
  'X-RateLimit-Limit': String(limit.limit),
  'X-RateLimit-Remaining': String(Math.max(0, limit.remaining)),
  'X-RateLimit-Reset': new Date(limit.reset).toISOString(),
});

/**
 * GET /api/bgcs/[id]/download?format=gbk|fna|faa
 *
 * All formats derive from the region .gbk, read from the combined archive by
 * offset, else from the run tarball. The tarball path can't find three custom
 * sources whose tarball names are not their filenames' prefix.
 */
async function fromCombinedArchive(id: string): Promise<Buffer | null> {
  try {
    const [region] = await exportRegionsByIds([id]);
    if (region?.gbkOffset == null || region.gbkLength == null) return null;
    return await readCombinedRegion(id, region.gbkOffset, region.gbkLength);
  } catch (error) {
    console.warn(`[bgc-download] ${id}: combined archive unavailable, reading the run tarball:`,
      error instanceof Error ? error.message : error);
    return null;
  }
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = (request.nextUrl.searchParams.get('format') ?? 'gbk') as Format;
  if (!(format in FORMATS)) return fail(400, 'format must be one of gbk, fna, faa');
  if (!UUID_RE.test(id)) return fail(400, 'Invalid BGC id');

  // A removed duplicate redirects to its twin, before the limiter.
  const twin = await findBgcRedirect(id);
  if (twin) {
    const target = new URL(request.url);
    target.pathname = target.pathname.replace(/\/[^/]+\/download$/, `/${twin}/download`);
    return redirectToTwin(target);
  }

  // /api/bgcs is exempt from the middleware limiter, and this can decompress a
  // multi-GB archive.
  const limit = await checkRateLimit(downloadRateLimit, getClientIp(request));
  if (!limit.success) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    return fail(
      429,
      `Download limit reached: ${limit.limit} BGC files at once, then ${DOWNLOAD_REFILL_PER_MINUTE} a minute, per address. `
        + `The next one is available in ${retryAfter} seconds (Retry-After). `
        + 'For many regions at once, use a bulk download instead (see bulkDownloads).',
      { 'Retry-After': String(retryAfter), ...rateHeaders(limit) },
      { bulkDownloads: BULK_DOWNLOADS },
    );
  }

  try {
    const bgc = await prisma.bgc.findUnique({
      where: { id },
      select: { id: true, filename: true, antismash_run: { select: { id: true, file_path: true } } },
    });
    if (!bgc) {
      return fail(404, 'BGC not found');
    }

    let gbk = await fromCombinedArchive(bgc.id);
    if (!gbk) try {
      gbk = await readRegionGbk({
        runId: bgc.antismash_run?.id ?? null,
        archivePath: bgc.antismash_run?.file_path ?? null,
        filename: bgc.filename,
      });
    } catch (error) {
      if (error instanceof RegionBusyError) {
        return fail(503, 'The server is busy extracting other regions. Please retry in a few seconds.', { 'Retry-After': '10' });
      }
      if (error instanceof RegionNotFoundError) {
        console.warn(`[bgc-download] ${id}: ${error.message}`);
        return fail(404, 'The region file for this BGC is not available.');
      }
      throw error;
    }

    let body: string | Uint8Array<ArrayBuffer> = new Uint8Array(gbk);
    let contentType = 'text/plain; charset=utf-8';
    if (format !== 'gbk') {
      const text = gbk.toString('utf8');
      body = format === 'fna'
        ? genbankToNucleotideFasta(text, `${bgc.id} ${bgc.filename}`)
        : genbankToProteinFasta(text, bgc.id);
      contentType = 'text/x-fasta; charset=utf-8';
      if (!body) return fail(404, `This region has no ${FORMATS[format]} content.`);
    }


    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${downloadFilename(bgc.filename, format)}"`,
        'Cache-Control': 'public, max-age=86400',
        ...rateHeaders(limit),
      },
    });
  } catch (error) {
    console.error(`[bgc-download] ${id} failed:`, error);
    return fail(500, 'Could not prepare the download.');
  }
}
