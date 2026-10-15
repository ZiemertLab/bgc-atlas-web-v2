import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { stripSourcePrefix } from '@/lib/utils/sample-id';
import { serverError } from '@/lib/api/errors';
import { isValidUuid } from '@/lib/entity-loaders';

const ensureArray = <T>(value: T[] | null | undefined) => (Array.isArray(value) ? value : []);

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

// How many related samples the panel lists. Everything else about a study's
// samples (count, bounds, environment tally) is aggregated in SQL: the GTDB
// umbrella study has over 70,000 samples.
const RELATED_SAMPLE_PREVIEW = 6;

type GroupRow = {
  gkey: string;
  sample_count: number;
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
  environment_distribution: Record<string, number> | null;
  preview: Array<{
    id: string;
    external_id: string | null;
    name: string | null;
    environment_biome: string | null;
    lat: number | null;
    lon: number | null;
  }> | null;
};

// One logical study can be split across many Study rows sharing a study_name
// (one sample each), so related samples are gathered across all of them; a row
// with no name keeps its own samples (group key = its id).
const studyGroupKey = (study: { id: string; study_name: string | null }) =>
  study.study_name && study.study_name.trim() ? study.study_name : study.id;

async function loadSampleStudies(sampleId: string) {
  const studies = await prisma.study.findMany({
    where: {
      study_samples: {
        some: { sample_id: sampleId },
      },
    },
    include: {
      study_biomes: {
        include: {
          biome: {
            include: {
              parent: true,
            },
          },
        },
      },
    },
    orderBy: [
      { created_at: 'desc' },
      { title: 'asc' },
    ],
  });

  if (studies.length === 0) {
    return [];
  }

  const studyNames = Array.from(
    new Set(studies.filter((s) => studyGroupKey(s) !== s.id).map((s) => s.study_name as string))
  );
  const unnamedIds = studies.filter((s) => studyGroupKey(s) === s.id).map((s) => s.id);

  const groups = await prisma.$queryRaw<GroupRow[]>(Prisma.sql`
    WITH rel AS MATERIALIZED (
      SELECT s.study_name AS gkey, ss.sample_id
      FROM studies s JOIN study_samples ss ON ss.study_id = s.id
      WHERE s.study_name = ANY(${studyNames}::text[])
      UNION
      SELECT s.id::text AS gkey, ss.sample_id
      FROM studies s JOIN study_samples ss ON ss.study_id = s.id
      WHERE s.id = ANY(${unnamedIds}::uuid[])
    ), j AS MATERIALIZED (
      SELECT rel.gkey, sm.id, sm.external_id, sm.name, sm.environment_biome,
             sm.latitude::float8 AS lat, sm.longitude::float8 AS lon
      FROM rel JOIN samples sm ON sm.id = rel.sample_id
    )
    SELECT g.gkey, g.sample_count, g.north, g.south, g.east, g.west,
      (SELECT json_object_agg(e.env, e.n) FROM (
         SELECT COALESCE(j.environment_biome, 'Unknown') AS env, count(*)::int AS n
         FROM j WHERE j.gkey = g.gkey GROUP BY 1) e) AS environment_distribution,
      (SELECT json_agg(p) FROM (
         SELECT j.id, j.external_id, j.name, j.environment_biome, j.lat, j.lon
         FROM j WHERE j.gkey = g.gkey ORDER BY j.id LIMIT ${RELATED_SAMPLE_PREVIEW}) p) AS preview
    FROM (
      SELECT gkey, count(*)::int AS sample_count,
             max(lat) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL) AS north,
             min(lat) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL) AS south,
             max(lon) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL) AS east,
             min(lon) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL) AS west
      FROM j GROUP BY gkey
    ) g
  `);
  const groupByKey = new Map(groups.map((g) => [g.gkey, g]));

  return studies.map((study) => {
    const group = groupByKey.get(studyGroupKey(study));

    const relatedSampleSummaries = (group?.preview ?? []).map((related) => ({
      id: related.id,
      external_id: stripSourcePrefix(related.external_id) ?? undefined,
      name: related.name ?? undefined,
      environment_biome: related.environment_biome ?? undefined,
      latitude: related.lat ?? undefined,
      longitude: related.lon ?? undefined,
    }));

    const biomes = study.study_biomes
      .map((relation) => relation.biome)
      .filter((biome): biome is NonNullable<typeof biome> => Boolean(biome))
      .map((biome) => ({
        id: biome.id,
        name: biome.name,
        description: biome.description ?? undefined,
        level: biome.level ?? undefined,
        parent: biome.parent
          ? {
              id: biome.parent.id,
              name: biome.parent.name,
            }
          : null,
      }));

    const geographicBounds =
      group && group.north !== null && group.south !== null && group.east !== null && group.west !== null
        ? {
            north: group.north,
            south: group.south,
            east: group.east,
            west: group.west,
            center: {
              latitude: (group.north + group.south) / 2,
              longitude: (group.east + group.west) / 2,
            },
          }
        : undefined;

    return {
      id: study.id,
      external_id: study.external_id ?? undefined,
      title: study.title ?? undefined,
      abstract: study.abstract ?? undefined,
      study_type: study.study_type ?? undefined,
      study_name: study.study_name ?? undefined,
      center_name: study.center_name ?? undefined,
      accession: study.accession ?? undefined,
      bioproject: study.bioproject ?? undefined,
      secondary_accession: study.secondary_accession ?? undefined,
      data_source_ids: ensureArray(study.data_source_ids),
      biome_ids: ensureArray(study.biome_ids),
      metadata: study.metadata && typeof study.metadata === 'object' ? (study.metadata as Record<string, unknown>) : {},
      created_at: toIsoString(study.created_at),
      updated_at: toIsoString(study.updated_at),
      biomes,
      sample_count: group?.sample_count ?? 0,
      // A preview of the first RELATED_SAMPLE_PREVIEW, not the full list;
      // sample_count is the total.
      related_samples: relatedSampleSummaries,
      geographic_bounds: geographicBounds,
      environment_distribution: group?.environment_distribution ?? {},
    };
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  const sampleId = params?.id;

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
    const sampleExists = await prisma.sample.findUnique({
      where: { id: sampleId },
      select: { id: true },
    });

    if (!sampleExists) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sample not found',
          message: 'No sample exists with the provided id.',
        },
        { status: 404 }
      );
    }

    const formatted = await getOrSetCache(
      `samples:studies:v2:${sampleId}`,
      () => loadSampleStudies(sampleId),
      300,
    );

    const summary = formatted.reduce(
      (acc, study) => {
        acc.total_studies += 1;
        acc.total_related_samples += study.sample_count;

        if (study.study_type) {
          acc.study_types.add(study.study_type);
        }
        if (study.center_name) {
          acc.center_names.add(study.center_name);
        }
        if (study.bioproject) {
          acc.bioprojects.add(study.bioproject);
        }

        study.biomes.forEach((biome) => {
          acc.all_biomes.add(biome.name);
        });

        return acc;
      },
      {
        total_studies: 0,
        study_types: new Set<string>(),
        total_related_samples: 0,
        all_biomes: new Set<string>(),
        center_names: new Set<string>(),
        bioprojects: new Set<string>(),
      }
    );

    return NextResponse.json(
      {
        success: true,
        data: formatted,
        total: formatted.length,
        summary: {
          total_studies: summary.total_studies,
          study_types: Array.from(summary.study_types).sort(),
          total_related_samples: summary.total_related_samples,
          all_biomes: Array.from(summary.all_biomes).sort(),
          center_names: Array.from(summary.center_names).sort(),
          bioprojects: Array.from(summary.bioprojects).sort(),
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    return serverError(error, 'Failed to load sample studies');
  }
}
