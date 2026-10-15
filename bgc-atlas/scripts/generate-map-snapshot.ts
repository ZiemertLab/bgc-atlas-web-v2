/**
 * Generates content-hashed static JSON snapshots of the unfiltered map data,
 * with manifests at /data/<name>.manifest.json pointing at the current version.
 *
 *   map-samples  metagenomes, raw per-sample records (homepage + /samples).
 *   map-genomes  isolate|MAG|SAG, aggregated per coordinate (/genome-collections);
 *                the raw set is ~80MB, so per-sample drill-down is unavailable.
 *
 * Run when the underlying sample data changes:
 *   npx tsx scripts/generate-map-snapshot.ts
 *   git add public/data/map-samples-*.json public/data/map-samples.manifest.json \
 *           public/data/map-genomes-*.json public/data/map-genomes.manifest.json
 *   git commit -m "data: refresh map snapshots"
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
// Relative import: tsx does not resolve the `@/` alias.
import { bucketFromGold, type GoldBucket } from '../src/lib/utils/gold-buckets';
import { pruneSuperseded } from './lib/snapshot-files';

const prisma = new PrismaClient();

const COORD_PRECISION = 4; // ~11 m — matches the map's client-side clustering.
const round4 = (n: number) => Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;

type RawSnapshotSample = {
  id: string;
  externalId: string | null;
  name: string | null;
  latitude: number;
  longitude: number;
  goldEcosystemPath: string | null;
  bgcCount: number;
};

type AggregatedCluster = {
  latitude: number;
  longitude: number;
  count: number;
  totalBgc: number;
  buckets: Partial<Record<GoldBucket, number>>;
};

type Row = {
  id: string;
  external_id: string | null;
  name: string | null;
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  gold_ecosystem_path: string | null;
  bgc_count: number;
};

const outDir = path.resolve(__dirname, '..', 'public', 'data');

async function generateSnapshot(opts: {
  label: string;
  sourceTypes: string[];
  baseName: string;
  aggregate: boolean;
}) {
  const { label, sourceTypes, baseName, aggregate } = opts;
  console.log(`Querying sample_map_view for ${label} (sourceType=${sourceTypes.join('|')})…`);

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      sb.id,
      sb.external_id,
      sb.name,
      sb.latitude,
      sb.longitude,
      sb.gold_ecosystem_path,
      sb.bgc_count
    FROM sample_map_view sb
    WHERE sb.latitude IS NOT NULL
      AND sb.longitude IS NOT NULL
      AND sb.external_id IS NOT NULL
      AND sb.source_types && ${sourceTypes}::text[]
    ORDER BY sb.bgc_count DESC, sb.external_id NULLS LAST
  `);

  // external_id IS NOT NULL mirrors buildOuterFilters in /api/samples/map, so
  // the snapshot plots exactly what the filtered live map would.
  const missingGeoResult = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM sample_summary sb
    WHERE (sb.latitude IS NULL OR sb.longitude IS NULL)
      AND sb.external_id IS NOT NULL
      AND sb.source_types && ${sourceTypes}::text[]
  `);
  const missingGeolocation = missingGeoResult?.[0]?.total ?? 0;

  let payload: Record<string, unknown>;
  let itemCount: number;

  if (aggregate) {
    const groups = new Map<string, AggregatedCluster>();
    for (const r of rows) {
      if (r.latitude === null || r.longitude === null) continue;
      const lat = round4(Number(r.latitude));
      const lng = round4(Number(r.longitude));
      const key = `${lat}|${lng}`;
      let c = groups.get(key);
      if (!c) {
        c = { latitude: lat, longitude: lng, count: 0, totalBgc: 0, buckets: {} };
        groups.set(key, c);
      }
      c.count += 1;
      c.totalBgc += r.bgc_count ?? 0;
      const bucket = bucketFromGold(r.gold_ecosystem_path);
      c.buckets[bucket] = (c.buckets[bucket] ?? 0) + 1;
    }
    const data = Array.from(groups.values());
    itemCount = data.length;
    payload = { total: rows.length, missingGeolocation, aggregated: true, data };
  } else {
    const data: RawSnapshotSample[] = rows.map(r => ({
      id: r.id,
      externalId: r.external_id ?? null,
      name: r.name ?? null,
      latitude: round4(Number(r.latitude)),
      longitude: round4(Number(r.longitude)),
      goldEcosystemPath: r.gold_ecosystem_path ?? null,
      bgcCount: r.bgc_count ?? 0,
    }));
    itemCount = data.length;
    payload = { total: data.length, missingGeolocation, data };
  }

  const payloadJson = JSON.stringify(payload);
  const hash = createHash('sha256').update(payloadJson).digest('hex').slice(0, 16);
  const generatedAt = new Date().toISOString();

  fs.mkdirSync(outDir, { recursive: true });

  const dataFilename = `${baseName}-${hash}.json`;
  const dataPath = path.join(outDir, dataFilename);
  fs.writeFileSync(dataPath, payloadJson);

  const manifest = {
    version: hash,
    generatedAt,
    total: rows.length,
    missingGeolocation,
    aggregated: aggregate,
    url: `/data/${dataFilename}`,
  };
  const manifestPath = path.join(outDir, `${baseName}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`  ${label} snapshot:`);
  console.log(`    samples: ${rows.length}${aggregate ? ` (aggregated into ${itemCount} clusters)` : ''}`);
  console.log(`    missingGeolocation: ${missingGeolocation}`);
  console.log(`    version: ${hash}`);
  console.log(`    data:     public/data/${dataFilename} (${(fs.statSync(dataPath).size / 1024).toFixed(1)} KB)`);
  console.log(`    manifest: public/data/${baseName}.manifest.json`);

  return { baseName, dataFilename };
}

async function main() {
  const generated = [];
  generated.push(await generateSnapshot({
    label: 'metagenomes',
    sourceTypes: ['metagenome'],
    baseName: 'map-samples',
    aggregate: false,
  }));
  generated.push(await generateSnapshot({
    label: 'genome collections',
    sourceTypes: ['isolate', 'MAG', 'SAG'],
    baseName: 'map-genomes',
    aggregate: true,
  }));

  console.log();
  pruneSuperseded({
    outDir,
    pattern: /^map-(samples|genomes)-[a-f0-9]+\.json$/,
    keep: generated.map(g => g.dataFilename),
    label: 'map',
  });
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
