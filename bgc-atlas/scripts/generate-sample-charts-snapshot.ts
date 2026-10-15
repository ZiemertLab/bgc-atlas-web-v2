/**
 * Generates a static JSON snapshot of the unfiltered /samples chart panel
 * (gold_level_1..5). Any active filter falls back to /api/statistics/samples.
 *
 * Run after each ingestion run:
 *   cd bgc-atlas
 *   npx tsx scripts/generate-sample-charts-snapshot.ts
 *   git add public/data/sample-charts-*.json public/data/sample-charts.manifest.json
 *   git commit -m "data: refresh sample charts snapshot"
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { pruneSuperseded } from './lib/snapshot-files';

const prisma = new PrismaClient();

const LIMIT = 15;

// Mirrors the gold-level grouping in /api/statistics/samples; keep in sync.
const GOLD_LEVELS = [1, 2, 3, 4, 5] as const;

function groupColumn(level: 1 | 2 | 3 | 4 | 5): Prisma.Sql {
  if (level === 1) {
    return Prisma.sql`SPLIT_PART(sb.gold_ecosystem_path, ':', 1)`;
  }
  if (level === 2) {
    return Prisma.sql`CASE
      WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 2) != ''
      THEN CONCAT(SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':', SPLIT_PART(sb.gold_ecosystem_path, ':', 2))
      ELSE NULL
    END`;
  }
  if (level === 3) {
    return Prisma.sql`CASE
      WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 3) != ''
      THEN CONCAT(
        SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':',
        SPLIT_PART(sb.gold_ecosystem_path, ':', 2), ':',
        SPLIT_PART(sb.gold_ecosystem_path, ':', 3)
      )
      ELSE NULL
    END`;
  }
  if (level === 4) {
    return Prisma.sql`CASE
      WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 4) != ''
      THEN CONCAT(
        SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':',
        SPLIT_PART(sb.gold_ecosystem_path, ':', 2), ':',
        SPLIT_PART(sb.gold_ecosystem_path, ':', 3), ':',
        SPLIT_PART(sb.gold_ecosystem_path, ':', 4)
      )
      ELSE NULL
    END`;
  }
  return Prisma.sql`CASE
    WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 5) != ''
    THEN CONCAT(
      SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':',
      SPLIT_PART(sb.gold_ecosystem_path, ':', 2), ':',
      SPLIT_PART(sb.gold_ecosystem_path, ':', 3), ':',
      SPLIT_PART(sb.gold_ecosystem_path, ':', 4), ':',
      SPLIT_PART(sb.gold_ecosystem_path, ':', 5)
    )
    ELSE NULL
  END`;
}

type DistRow = { name: string | null; count: number; bgc_count: number };
type ChartBucket = { name: string; samples: number; bgcs: number };

async function queryVariant(level: 1 | 2 | 3 | 4 | 5): Promise<ChartBucket[]> {
  const col = groupColumn(level);
  // Top-LIMIT plus an "Others" row, as in /api/statistics/samples. Keep in sync.
  const rows = await prisma.$queryRaw<DistRow[]>(Prisma.sql`
    WITH grouped AS (
      SELECT
        ${col} as name,
        COUNT(*)::int as count,
        COALESCE(SUM(sb.bgc_count), 0)::int as bgc_count
      FROM sample_summary sb
      WHERE sb.external_id IS NOT NULL
        AND ${col} IS NOT NULL
        AND ${col} != ''
      GROUP BY 1
    ),
    ranked AS (
      SELECT name, count, bgc_count,
        ROW_NUMBER() OVER (ORDER BY count DESC) AS rn
      FROM grouped
    )
    SELECT name, count, bgc_count
    FROM (
      SELECT name, count, bgc_count, rn AS sort_order
      FROM ranked
      WHERE rn <= ${LIMIT}
      UNION ALL
      SELECT 'Others', SUM(count)::int, SUM(bgc_count)::int, ${LIMIT} + 1
      FROM ranked
      WHERE rn > ${LIMIT}
      HAVING COUNT(*) > 0
    ) ordered
    ORDER BY sort_order
  `);
  return rows.map(row => ({
    name: row.name ? row.name.replace(/^root:\s*/i, '').trim() || 'Unknown' : 'Unknown',
    samples: row.count,
    bgcs: row.bgc_count || 0,
  }));
}

async function main() {
  console.log('Building Sample charts snapshot (unfiltered)...');

  const byVariant: Record<string, ChartBucket[]> = {};
  for (const level of GOLD_LEVELS) {
    const key = `gold_level_${level}`;
    console.log(`  ${key}`);
    byVariant[key] = await queryVariant(level);
  }

  const data = { byVariant };
  const payloadJson = JSON.stringify(data);
  const hash = createHash('sha256').update(payloadJson).digest('hex').slice(0, 16);
  const generatedAt = new Date().toISOString();

  const outDir = path.resolve(__dirname, '..', 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const dataFilename = `sample-charts-${hash}.json`;
  const dataPath = path.join(outDir, dataFilename);
  fs.writeFileSync(dataPath, payloadJson);

  const manifest = {
    version: hash,
    generatedAt,
    url: `/data/${dataFilename}`,
    variantCount: Object.keys(byVariant).length,
  };
  const manifestPath = path.join(outDir, 'sample-charts.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log();
  console.log('Snapshot generated:');
  console.log(`  version: ${hash}`);
  console.log(`  variants: ${Object.keys(byVariant).length} (${Object.keys(byVariant).join(', ')})`);
  console.log(`  data:     public/data/${dataFilename} (${(fs.statSync(dataPath).size / 1024).toFixed(1)} KB)`);
  console.log(`  manifest: public/data/sample-charts.manifest.json`);

  console.log();
  pruneSuperseded({
    outDir,
    pattern: /^sample-charts-[a-f0-9]+\.json$/,
    keep: [dataFilename],
    label: 'sample-charts',
  });
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
