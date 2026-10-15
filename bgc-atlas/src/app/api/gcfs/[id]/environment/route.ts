import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCacheWithMetadata } from '@/lib/cache';
import {
  ENVIRONMENT_FIELDS,
  summarizeEnvField,
  type EnvFieldSummary,
} from '@/lib/utils/environment-fields';
import { serverError } from '@/lib/api/errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldRow = Record<string, number | null>;

/**
 * One column per catalogue entry, gated by its unit so an analyte recorded in
 * two units arrives as two columns. float8 avoids 300k Decimal objects.
 */
function buildSelectList(): Prisma.Sql {
  return Prisma.join(
    ENVIRONMENT_FIELDS.map((f) => {
      const col = Prisma.raw(`s.${f.column}`);
      const value = f.unitColumn
        ? Prisma.sql`CASE WHEN s.${Prisma.raw(f.unitColumn)} = ${f.unitValue} THEN ${col} END`
        : Prisma.sql`${col}`;
      return Prisma.sql`(${value})::float8 AS ${Prisma.raw(`"${f.key}"`)}`;
    }),
    ', '
  );
}

function buildAnyPresentClause(): Prisma.Sql {
  return Prisma.join(
    ENVIRONMENT_FIELDS.map((f) => Prisma.sql`s.${Prisma.raw(f.column)} IS NOT NULL`),
    ' OR '
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: gcfId } = await context.params;

  if (!UUID_REGEX.test(gcfId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid GCF ID', message: 'The provided GCF ID is not a valid UUID' },
      { status: 400 }
    );
  }

  // Versioned: a stale older shape would read as "no measurements".
  const cacheKey = `gcf:${gcfId}:environment:v1`;

  try {
    const { data: payload, isHit } = await getOrSetCacheWithMetadata(cacheKey, async () => {
      const [rows, countResult] = await Promise.all([
        prisma.$queryRaw<FieldRow[]>(Prisma.sql`
          SELECT ${buildSelectList()}
          FROM gcf_sample_map_mv m
          JOIN samples s ON s.id = m.id
          WHERE m.gcf_id = ${gcfId}::uuid
            AND (${buildAnyPresentClause()})
        `),
        prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM gcf_sample_map_mv
          WHERE gcf_id = ${gcfId}::uuid
        `),
      ]);

      const totalSamples = countResult?.[0]?.total ?? rows.length;

      const fields = ENVIRONMENT_FIELDS.map((def) =>
        summarizeEnvField(
          def,
          rows.map((r) => r[def.key])
        )
      )
        .filter((s): s is EnvFieldSummary => s !== null)
        .sort((a, b) => b.n - a.n);

      return { success: true, fields, totalSamples };
    }, 3600);

    const response = NextResponse.json(payload);
    response.headers.set('X-Cache', isHit ? 'HIT' : 'MISS');
    response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return response;
  } catch (error) {
    return serverError(error, 'Failed to load GCF environmental measurements');
  }
}
