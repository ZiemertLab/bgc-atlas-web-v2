import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { sampleBrowseDocs } from '@/lib/opensearch/client';

/**
 * Map rows for an ad-hoc set of samples, each with a count of the BGCs that put it there.
 *
 * Shared by the two maps that plot a search's samples rather than a stored set: the sequence
 * search (hit BGCs per sample) and the Property Search (matching BGCs per sample). The rows
 * have the shape SampleMapDots takes, so both render it unchanged.
 */

export interface SampleMapRow {
  id: string;
  externalId: string | null;
  name: string | null;
  location: string | null;
  latitude?: number;
  longitude?: number;
  environmentBiome: string | null;
  goldEcosystemPath: string | null;
  environmentMaterial: string | null;
  environmentFeature: string | null;
  hostScientificName: string | null;
  dataSourceNames: string[];
  studyTitles: string[];
  assemblyCount: number;
  /** BGCs in the searched set from this sample — not the sample's total. */
  bgcCount: number;
  sourceTypes: string[];
}

interface SampleFields {
  external_id: string | null;
  name: string | null;
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  geographic_location: string | null;
  environment_biome: string | null;
  gold_ecosystem_path: string | null;
  environment_feature: string | null;
  environment_material: string | null;
  host_scientific_name: string | null;
}

const SAMPLE_FIELDS = [
  'external_id', 'name', 'latitude', 'longitude', 'geographic_location', 'environment_biome',
  'gold_ecosystem_path', 'environment_feature', 'environment_material', 'host_scientific_name',
];

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The map fields of each sample: sample_browse, then samples by primary key for misses. */
async function sampleFields(sampleIds: string[]): Promise<Map<string, SampleFields>> {
  const out = new Map<string, SampleFields>();
  try {
    for (const [sampleId, doc] of await sampleBrowseDocs(sampleIds, SAMPLE_FIELDS)) {
      out.set(sampleId, {
        external_id: nullableString(doc.external_id),
        name: nullableString(doc.name),
        latitude: nullableNumber(doc.latitude),
        longitude: nullableNumber(doc.longitude),
        geographic_location: nullableString(doc.geographic_location),
        environment_biome: nullableString(doc.environment_biome),
        gold_ecosystem_path: nullableString(doc.gold_ecosystem_path),
        environment_feature: nullableString(doc.environment_feature),
        environment_material: nullableString(doc.environment_material),
        host_scientific_name: nullableString(doc.host_scientific_name),
      });
    }
  } catch (error) {
    console.warn(`Could not read ${sampleIds.length} samples from OpenSearch; using Postgres:`, error);
  }
  const missing = sampleIds.filter((id) => !out.has(id));
  if (missing.length) {
    const rows = await prisma.$queryRaw<Array<SampleFields & { id: string }>>(Prisma.sql`
      SELECT s.id::text AS id, s.external_id, s.name, s.latitude, s.longitude,
             s.geographic_location, s.environment_biome, s.gold_ecosystem_path,
             s.environment_feature, s.environment_material, s.host_scientific_name
      FROM samples s
      WHERE s.id = ANY(${missing}::uuid[])
    `);
    for (const { id, ...fields } of rows) out.set(id, fields);
  }
  return out;
}

/**
 * One row per sample with coordinates, most BGCs first, at most `limit` of them — so a cap
 * drops the sparsest samples rather than arbitrary ones. Samples without coordinates are
 * dropped: a map cannot place them.
 */
export async function sampleMapRows(bgcCounts: Map<string, number>, limit: number): Promise<SampleMapRow[]> {
  const samples = await sampleFields([...bgcCounts.keys()]);

  const placed: Array<{ id: string; count: number; fields: SampleFields; latitude: number; longitude: number }> = [];
  for (const [id, count] of bgcCounts) {
    const fields = samples.get(id);
    if (!fields || fields.latitude === null || fields.longitude === null) continue;
    placed.push({ id, count, fields, latitude: Number(fields.latitude), longitude: Number(fields.longitude) });
  }
  placed.sort((a, b) => b.count - a.count);

  return placed.slice(0, limit).map(({ id, count, fields, latitude, longitude }) => ({
    id,
    externalId: fields.external_id,
    name: fields.name,
    location: fields.geographic_location ?? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    latitude,
    longitude,
    environmentBiome: fields.environment_biome,
    goldEcosystemPath: fields.gold_ecosystem_path,
    environmentFeature: fields.environment_feature,
    environmentMaterial: fields.environment_material,
    hostScientificName: fields.host_scientific_name,
    dataSourceNames: [],
    studyTitles: [],
    assemblyCount: 0,
    bgcCount: count,
    sourceTypes: [],
  }));
}
