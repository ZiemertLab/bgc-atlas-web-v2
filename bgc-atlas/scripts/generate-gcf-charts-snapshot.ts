/**
 * Generates static JSON snapshots of the /gcfs distribution chart panel.
 *
 * Emits:
 *   public/data/gcf-charts-<hash>.json   (the data)
 *   public/data/gcf-charts.manifest.json (pointer, what the page loads)
 *
 * Run after each ingestion / re-clustering run:
 *   cd bgc-atlas
 *   npx tsx scripts/generate-gcf-charts-snapshot.ts
 *   git add public/data/gcf-charts-*.json public/data/gcf-charts*.manifest.json
 *   git commit -m "data: refresh GCF charts snapshots"
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { pruneSuperseded } from './lib/snapshot-files';

const prisma = new PrismaClient();

const toNum = (val: number | string | bigint): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
};

async function buildSnapshot() {
  type ProductDistRow = { product_category: string; gcf_count: number | string };
  const productDistRows = await prisma.$queryRaw<ProductDistRow[]>(Prisma.sql`
    SELECT
      m.product_category,
      COUNT(DISTINCT m.gcf_id) as gcf_count
    FROM gcf_product_type_matrix_mv m
    JOIN gcfs g ON g.id = m.gcf_id
    WHERE m.product_category IS NOT NULL AND m.product_category != ''
      AND g.listed
    GROUP BY m.product_category
    ORDER BY gcf_count DESC
    LIMIT 12
  `);

  type SizeDistRow = { size_range: string; gcf_count: number | string };
  const sizeDistRows = await prisma.$queryRaw<SizeDistRow[]>(Prisma.sql`
    WITH size_buckets AS (
      SELECT
        CASE
          WHEN member_bgc_count BETWEEN 1 AND 10 THEN '1-10'
          WHEN member_bgc_count BETWEEN 11 AND 50 THEN '11-50'
          WHEN member_bgc_count BETWEEN 51 AND 100 THEN '51-100'
          WHEN member_bgc_count BETWEEN 101 AND 500 THEN '101-500'
          WHEN member_bgc_count BETWEEN 501 AND 1000 THEN '501-1000'
          WHEN member_bgc_count > 1000 THEN '1000+'
          ELSE NULL
        END as size_range,
        CASE
          WHEN member_bgc_count BETWEEN 1 AND 10 THEN 1
          WHEN member_bgc_count BETWEEN 11 AND 50 THEN 2
          WHEN member_bgc_count BETWEEN 51 AND 100 THEN 3
          WHEN member_bgc_count BETWEEN 101 AND 500 THEN 4
          WHEN member_bgc_count BETWEEN 501 AND 1000 THEN 5
          WHEN member_bgc_count > 1000 THEN 6
          ELSE NULL
        END as sort_order
      FROM gcf_summary_mv s
      JOIN gcfs g ON g.id = s.gcf_id
      WHERE s.member_bgc_count > 0
        AND g.listed
    )
    SELECT
      size_range,
      COUNT(*) as gcf_count
    FROM size_buckets
    GROUP BY size_range, sort_order
    ORDER BY sort_order
  `);

  type FullSizeDistRow = { size: number; count: number | string };
  const fullSizeDistRows = await prisma.$queryRaw<FullSizeDistRow[]>(Prisma.sql`
    SELECT
      s.member_bgc_count as size,
      COUNT(*)::int as count
    FROM gcf_summary_mv s
    JOIN gcfs g ON g.id = s.gcf_id
    WHERE s.member_bgc_count > 0
      AND g.listed
    GROUP BY s.member_bgc_count
    ORDER BY s.member_bgc_count ASC
  `);

  // Same shape as /api/gcfs/stats `data`.
  return {
    categoryDistribution: productDistRows.map(row => ({
      category: row.product_category,
      count: toNum(row.gcf_count),
    })),
    sizeDistribution: sizeDistRows.map(row => ({
      range: row.size_range,
      count: toNum(row.gcf_count),
    })),
    fullSizeDistribution: fullSizeDistRows.map(row => ({
      size: toNum(row.size),
      count: toNum(row.count),
    })),
  };
}

async function main() {
  console.log('Building GCF charts snapshots (per resolution)...');

  const outDir = path.resolve(__dirname, '..', 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const written: string[] = [];

  {
    const data = await buildSnapshot();

    const payloadJson = JSON.stringify(data);
    const hash = createHash('sha256').update(payloadJson).digest('hex').slice(0, 16);

    const dataFilename = `gcf-charts-${hash}.json`;
    fs.writeFileSync(path.join(outDir, dataFilename), payloadJson);
    written.push(dataFilename);

    const manifest = {
      version: hash,
      generatedAt,
      url: `/data/${dataFilename}`,
      categoryDistributionCount: data.categoryDistribution.length,
      sizeDistributionCount: data.sizeDistribution.length,
      fullSizeDistributionCount: data.fullSizeDistribution.length,
    };
    fs.writeFileSync(
      path.join(outDir, 'gcf-charts.manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
    written.push('gcf-charts.manifest.json');

    console.log(
      `    version=${hash}  product=${data.categoryDistribution.length}` +
      `  buckets=${data.sizeDistribution.length}  distinctSizes=${data.fullSizeDistribution.length}`
    );
  }

  console.log('\nWrote:');
  for (const f of written) console.log(`  public/data/${f}`);

  console.log();
  pruneSuperseded({
    outDir,
    pattern: /^gcf-charts-.*\.json$/,
    keep: written.filter(f => !f.endsWith('.manifest.json')),
    label: 'gcf-charts',
  });
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
