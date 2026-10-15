/**
 * Generates a static JSON snapshot of every BGC chart variant the /bgcs page
 * can show. Uses the same aggregation builder as /api/bgcs/distribution so the
 * unfiltered snapshot and live filtered bars never disagree.
 *
 * Run after an ingestion run and browse reindex:
 *   cd bgc-atlas
 *   npx tsx scripts/generate-bgc-charts-snapshot.ts
 *   git add public/data/bgc-charts-*.json public/data/bgc-charts.manifest.json
 *   git commit -m "data: refresh BGC charts snapshot"
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// tsx does not resolve the tsconfig `@/` alias, so imports are relative.
import { aggregateBrowseIndex } from '../src/lib/opensearch/browse-client';
import { buildBrowseFilters } from '../src/lib/opensearch/browse-query';
import {
  buildDistributionRequest, parseDistributionResponse, DISTRIBUTION_VARIANTS,
  type ChartBucket, type DistributionVariant, type ProductClassBucket,
} from '../src/lib/opensearch/bgc-distribution';

import { pruneSuperseded } from './lib/snapshot-files';

async function main() {
  console.log('Building BGC charts snapshot from bgc_browse...');

  // Empty params, not an empty clause, so the baseline is built exactly as the
  // endpoint builds it and the totals match what a cleared filter returns.
  const baseline = buildBrowseFilters('bgcs', new URLSearchParams());

  const byVariant: Record<string, ChartBucket[]> = {};
  let categoryDistribution: ChartBucket[] = [];
  let classDistribution: ProductClassBucket[] = [];
  let totalBgcs = 0;

  for (const variant of Object.keys(DISTRIBUTION_VARIANTS) as DistributionVariant[]) {
    console.log(`  ${variant}`);
    // The antiSMASH-class tallies do not depend on `variant` either; one
    // request carries them rather than paying for that agg twelve times.
    const withClasses = classDistribution.length === 0;
    const response = await aggregateBrowseIndex('bgcs', buildDistributionRequest(variant, baseline, { withClasses }));
    const result = parseDistributionResponse(variant, response);
    if (withClasses) classDistribution = result.classDistribution ?? [];
    if (result.truncated) throw new Error(`terms agg truncated for ${variant} — raise GROUP_TERMS_SIZE`);
    byVariant[variant] = result.distribution;

    // Every variant carries the same filter and `classes` agg; a mismatch means
    // the index changed mid-run.
    const classesJson = JSON.stringify(result.categoryDistribution);
    if (categoryDistribution.length && JSON.stringify(categoryDistribution) !== classesJson) {
      throw new Error(`categoryDistribution changed at ${variant} — the index moved mid-run`);
    }
    if (totalBgcs && totalBgcs !== result.totalBgcs) {
      throw new Error(`totalBgcs changed at ${variant} (${totalBgcs} -> ${result.totalBgcs}) — the index moved mid-run`);
    }
    categoryDistribution = result.categoryDistribution;
    totalBgcs = result.totalBgcs;
  }

  const payload = { categoryDistribution, classDistribution, byVariant, totalBgcs };
  const payloadJson = JSON.stringify(payload);
  const hash = createHash('sha256').update(payloadJson).digest('hex').slice(0, 16);
  const generatedAt = new Date().toISOString();

  const outDir = path.resolve(__dirname, '..', 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const dataFilename = `bgc-charts-${hash}.json`;
  const dataPath = path.join(outDir, dataFilename);
  fs.writeFileSync(dataPath, payloadJson);

  const manifest = {
    version: hash,
    generatedAt,
    url: `/data/${dataFilename}`,
    categoryDistributionCount: categoryDistribution.length,
    variantCount: Object.keys(byVariant).length,
    totalBgcs,
  };
  const manifestPath = path.join(outDir, 'bgc-charts.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log();
  console.log('Snapshot generated:');
  console.log(`  version: ${hash}`);
  console.log(`  totalBgcs: ${totalBgcs.toLocaleString()}`);
  console.log(`  categoryDistribution: ${categoryDistribution.length} buckets`);
  console.log(`  variants: ${Object.keys(byVariant).length} (${Object.keys(byVariant).join(', ')})`);
  console.log(`  data:     public/data/${dataFilename} (${(fs.statSync(dataPath).size / 1024).toFixed(1)} KB)`);
  console.log(`  manifest: public/data/bgc-charts.manifest.json`);
  console.log();

  pruneSuperseded({
    outDir,
    pattern: /^bgc-charts-[a-f0-9]+\.json$/,
    keep: [dataFilename],
    label: 'bgc-charts',
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
