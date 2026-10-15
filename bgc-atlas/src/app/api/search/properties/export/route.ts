import { NextRequest, NextResponse } from 'next/server';
import type { FilterGroup } from '@/lib/filters/types';
import { scrollHits } from '@/lib/opensearch/client';
import { hydrateGcfNames } from '@/lib/opensearch/hydrate';
import { toDelimited, toJsonRows } from '@/lib/opensearch/export-columns';
import { exportEntities } from '@/lib/opensearch/entity-export';
import { FamilyScopeError } from '@/lib/opensearch/family-scope';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import { exportRateLimit, getClientIp, checkRateLimit } from '@/lib/rate-limit';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const CAP = 100_000;

interface ExportRequest {
  group?: FilterGroup | null;
  sort?: { field: string; order: 'asc' | 'desc' };
  format?: 'csv' | 'tsv' | 'json';
  /** Mirrors the Return switcher; absent means 'bgcs'. */
  entity?: 'bgcs' | 'gcfs' | 'samples';
  familyScope?: { cohorts: FilterGroup[]; minPurity?: number; labels?: string[] } | null;
}

const MIME: Record<'csv' | 'tsv' | 'json', string> = {
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

// POST /api/search/properties/export  { group, sort, format, entity?, familyScope? }
// 'bgcs' exports up to CAP documents (scroll); 'gcfs'/'samples' export aggregated
// entity rows bounded by ENTITY_CAP (terms agg).
export async function POST(req: NextRequest) {
  // middleware skips the general limiter for /api/search/*, so this route carries its own.
  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimit(exportRateLimit, clientIp);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: rateLimitResult.error },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimitResult.reset - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(rateLimitResult.limit),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
        },
      },
    );
  }

  let body: ExportRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const format = body.format ?? 'tsv';
  const entity = body.entity === 'gcfs' || body.entity === 'samples' ? body.entity : 'bgcs';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'tsv';

  try {
    if (entity !== 'bgcs') {
      const { content, count, capped } = await exportEntities({
        group: body.group ?? null,
        entity,
        familyScope: body.familyScope ?? null,
        format,
      });
      return new NextResponse(content, {
        status: 200,
        headers: {
          'Content-Type': MIME[format],
          'Content-Disposition': `attachment; filename="bgc_${entity}_${count}_${stamp}.${ext}"`,
          'X-Result-Count': String(count),
          'X-Capped': capped ? '1' : '0',
        },
      });
    }

    const rawHits = await scrollHits(body.group ?? null, body.sort ?? null, CAP);

    // bgc_facets carries everything except gcf_name, so resolve that by gcf_id.
    // Not hydrateDisplayFields: at export scale it walks bgcs (~40-50s per 10k
    // batch) and can hit the 120s statement_timeout.
    const gcfNames = await hydrateGcfNames(
      rawHits.map((h) => String(h.gcf_id ?? '')).filter(Boolean),
    );
    const hits = rawHits.map((h) => {
      const gid = String(h.gcf_id ?? '');
      const name = gid ? gcfNames[gid] : undefined;
      return name ? { ...h, gcf_name: name } : h;
    });

    const content = format === 'json'
      ? JSON.stringify(toJsonRows(hits), null, 2)
      : toDelimited(hits, format === 'csv' ? ',' : '\t');

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': MIME[format],
        'Content-Disposition': `attachment; filename="bgc_properties_${hits.length}_${stamp}.${ext}"`,
        'X-Result-Count': String(hits.length),
        'X-Capped': hits.length >= CAP ? '1' : '0',
      },
    });
  } catch (err) {
    // Nothing has streamed yet, so a 400 is still possible; a widened export file
    // would be read offline with nothing saying so.
    if (err instanceof UnhonourableQueryError) {
      return NextResponse.json(
        { error: err.message, rejected: err.conditions },
        { status: 400 },
      );
    }
    // A too-broad cohort set is the caller's query, as in the entities route.
    if (err instanceof FamilyScopeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return serverError(err, '[api/search/properties/export]', { status: 502 });
  }
}
