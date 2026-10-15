import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';
import { isValidUuid } from '@/lib/entity-loaders';

const DEFAULT_ASSEMBLY_LIMIT = 50;
const MAX_ASSEMBLY_LIMIT = 200;

const parseNumber = (value: string | null, fallback: number, min: number, max: number) => {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const ensureArray = <T>(value: T[] | null | undefined) => (Array.isArray(value) ? value : []);

const ensureRecord = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

export async function GET(request: Request, context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  const sampleId = params?.id;
  const url = new URL(request.url);
  const limit = parseNumber(url.searchParams.get('limit'), DEFAULT_ASSEMBLY_LIMIT, 1, MAX_ASSEMBLY_LIMIT);
  const offset = parseNumber(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

  if (!sampleId || typeof sampleId !== 'string' || !isValidUuid(sampleId)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid sample id',
        message: 'A valid sample id must be provided.',
      },
      { status: 400 }
    );
  }

  try {
    const sample = await prisma.sample.findUnique({
      where: { id: sampleId },
      select: { id: true },
    });

    if (!sample) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sample not found',
          message: 'No sample exists with the provided id.',
        },
        { status: 404 }
      );
    }

    const { assemblies, totalAssembliesAll, bgcCounts } = await getOrSetCache(
      `samples:${sampleId}:assemblies:${limit}:${offset}`,
      async () => {
        const [rows, totalAll] = await Promise.all([
          prisma.assembly.findMany({
            where: {
              sample_assemblies: {
                some: {
                  sample_id: sampleId,
                },
              },
            },
            include: {
              assembly_analyses: {
                include: {
                  analysis: true,
                },
              },
              // BGC totals come from the scoped groupBy below: Prisma's `_count`
              // groups the entire bgcs table (~1.5-7s).
              antismash_runs: {
                select: {
                  id: true,
                  name: true,
                  file_path: true,
                  num_bgcs: true,
                  created_at: true,
                  updated_at: true,
                },
                orderBy: {
                  created_at: 'desc',
                },
              },
            },
            orderBy: [
              { created_at: 'desc' },
              { id: 'asc' },
            ],
            take: limit,
            skip: offset,
          }),
          prisma.assembly.count({
            where: {
              sample_assemblies: {
                some: { sample_id: sampleId },
              },
            },
          }),
        ]);

        const assemblyIds = rows.map((a) => a.id);
        const countGroups = assemblyIds.length
          ? await prisma.bgc.groupBy({
              by: ['assembly'],
              where: { assembly: { in: assemblyIds } },
              _count: { _all: true },
            })
          : [];
        const bgcCounts: Record<string, number> = {};
        for (const g of countGroups) bgcCounts[g.assembly] = g._count._all;

        return { assemblies: rows, totalAssembliesAll: totalAll, bgcCounts };
      },
      120,
    );

    const assemblyTypes = new Set<string>();
    const sequencingTechnologies = new Set<string>();

    const formatted = assemblies.map((assembly) => {
      const { assembly_analyses: analysesRelation, antismash_runs: antismashRuns = [] } = assembly;
      const totalBgcs = bgcCounts[assembly.id] ?? 0;

      if (assembly.source_type) {
        assemblyTypes.add(assembly.source_type);
      }
      if (assembly.sequencing_technology) {
        sequencingTechnologies.add(assembly.sequencing_technology);
      }

      const analyses = analysesRelation
        .map((relation) => relation.analysis)
        .filter((analysis): analysis is NonNullable<typeof analysis> => Boolean(analysis))
        .map((analysis) => ({
          id: analysis.id,
          name: analysis.name ?? null,
          analysis_type: analysis.analysis_type ?? null,
          tool_name: analysis.tool_name ?? null,
          tool_version: analysis.tool_version ?? null,
        }));

      const formattedAntismashRuns = antismashRuns.map((run) => ({
        id: run.id,
        name: run.name ?? null,
        file_path: run.file_path ?? null,
        num_bgcs: typeof run.num_bgcs === 'number' ? run.num_bgcs : totalBgcs,
        created_at: toIsoString(run.created_at),
        updated_at: toIsoString(run.updated_at),
      }));

      return {
        id: assembly.id,
        external_id: assembly.external_id ?? null,
        name: assembly.name ?? null,
        source_type: assembly.source_type,
        assembly_level: assembly.assembly_level ?? null,
        sequencing_technology: assembly.sequencing_technology ?? null,
        contig_count: assembly.contig_count ?? null,
        bgc_count: totalBgcs,
        accession: assembly.accession ?? null,
        data_source_ids: ensureArray(assembly.data_source_ids),
        metadata: ensureRecord(assembly.metadata),
        created_at: toIsoString(assembly.created_at),
        updated_at: toIsoString(assembly.updated_at),
        analyses,
        antismash_runs: formattedAntismashRuns,
      };
    });

    const totalAssembliesInPage = formatted.length;
    const totalBgcs = formatted.reduce((acc, assembly) => acc + assembly.bgc_count, 0);

    const summary = {
      total_assemblies: totalAssembliesAll,
      total_bgcs: totalBgcs, // this page only
      assembly_types: Array.from(assemblyTypes).sort(),
      sequencing_technologies: Array.from(sequencingTechnologies).sort(),
    };

    return NextResponse.json(
      {
        success: true,
        data: formatted,
        total: totalAssembliesAll,
        limit,
        offset,
        page_size: totalAssembliesInPage,
        has_more: offset + totalAssembliesInPage < totalAssembliesAll,
        summary,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    return serverError(error, 'Failed to load sample assemblies');
  }
}
