import { NextRequest, NextResponse } from 'next/server';
import { findBgcRedirect, redirectToTwin } from '@/lib/bgc/redirect';

import prisma from '@/lib/prisma';
import { checkRateLimit, DOWNLOAD_REFILL_PER_MINUTE, downloadRateLimit, getClientIp } from '@/lib/rate-limit';
import { isHead } from '@/lib/http/abandoned-body';
import { genbankToNucleotideFasta, genbankToProteinFasta } from '@/lib/bgc-download/genbank';
import { readRegionGbk, RegionBusyError, RegionNotFoundError } from '@/lib/bgc-download/read-region';
import { downloadFilename } from '@/lib/bgc-download/region-member';
import { readCombinedRegion } from '@/lib/bgc-download/combined-archive';
import { exportRegionsByIds } from '@/lib/export/region-sources';
import { GCF_GBK_EXPORT_MAX_MEMBERS, PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';
import { readReleases } from '@/lib/releases/read';
import { formatReleaseSize } from '@/lib/releases/format-size';

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
  // The archive's size is read from the current release (bulkDownloads below); a
  // written-in "169 GB" matched neither the decimal nor the binary size.
  everything: `${SITE_URL}/downloads/all_regions_gbk.tar.gz ({size}members are named <bgc_id>.gbk; SHA-256 at the same URL + .sha256). Every bulk file is listed at ${SITE_URL}/downloads`,
  fromTheArchive: `With a local copy of the archive, ${SITE_URL}/downloads/extract_gbk.py and ${SITE_URL}/downloads/all_regions_gbk.index.tsv.gz pull out the BGCs you list without unpacking it; ${SITE_URL}/downloads/bgc_id_redirects.tsv.gz maps ids saved before 2026-10-05.`,
};

/** BULK_DOWNLOADS with the archive's size from the current release, when known. */
async function bulkDownloads() {
  const { files } = await readReleases();
  const archive = files.find((f) => f.path === 'all_regions_gbk.tar.gz');
  const size = archive?.bytes ? `${formatReleaseSize(archive.bytes)}; ` : '';
  return { ...BULK_DOWNLOADS, everything: BULK_DOWNLOADS.everything.replace('{size}', size) };
}
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

  // HEAD: Next runs this handler for it and drops the body, so a HEAD would do the
  // whole read (up to a minute of tar on the run-tarball path) and spend a
  // download. It is answered from the row alone: no read, no token.
  if (isHead(request)) {
    const exists = await prisma.bgc.findUnique({ where: { id }, select: { filename: true } });
    if (!exists) return fail(404, 'BGC not found');
    return new NextResponse(null, {
      headers: {
        'Content-Type': format === 'gbk' ? 'text/plain; charset=utf-8' : 'text/x-fasta; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadFilename(exists.filename, format)}"`,
        'Cache-Control': 'public, max-age=86400',
      },
    });
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
      { bulkDownloads: await bulkDownloads() },
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
