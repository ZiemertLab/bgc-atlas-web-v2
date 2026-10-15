import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';
import { isValidUuid } from '@/lib/entity-loaders';

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;

        // Not a uuid: the ::uuid cast below would throw and surface as a 500.
        if (!id || typeof id !== 'string' || !isValidUuid(id)) {
            return NextResponse.json(
                { error: 'Invalid sample ID' },
                { status: 400 }
            );
        }

        const payload = await getOrSetCache<{ sourceTypes: string[] | null }>(
            `samples:${id}:source-types`,
            async () => {
                const result = await prisma.$queryRaw<{ source_types: string[] | null }[]>(
                    Prisma.sql`
                SELECT source_types
                FROM sample_summary
                WHERE id = ${id}::uuid
                LIMIT 1
              `
                );
                if (!result || result.length === 0) {
                    return { sourceTypes: null };
                }
                return { sourceTypes: result[0].source_types ?? [] };
            },
            300,
        );

        if (payload.sourceTypes === null) {
            return NextResponse.json(
                { error: 'Sample not found' },
                { status: 404 }
            );
        }

        return NextResponse.json(
            { sourceTypes: payload.sourceTypes },
            { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
        );
    } catch (error) {
        return serverError(error, 'Failed to fetch sample source types');
    }
}
