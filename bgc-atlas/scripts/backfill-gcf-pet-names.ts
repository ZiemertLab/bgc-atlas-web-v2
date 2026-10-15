// One-off backfill of gcfs.pet_name. Run from bgc-atlas/:
//   npx tsx scripts/backfill-gcf-pet-names.ts --dry-run
//   npx tsx scripts/backfill-gcf-pet-names.ts --apply
import { PrismaClient, Prisma } from '@prisma/client';
import { petNameForGcfName, petNameForId, ADJECTIVES, NOUNS } from '../src/lib/gcf-pet-name';

const prisma = new PrismaClient();
const BATCH = 5_000;

// A permuted wordlist is still a valid bijection, so the collision guard cannot
// catch drift; these pins match the test suite.
function assertBijectionUnchanged(): void {
  const checks: [string, unknown, unknown][] = [
    ['ADJECTIVES.length', ADJECTIVES.length, 1198],
    ['NOUNS.length', NOUNS.length, 1052],
    ['petNameForId(1)', petNameForId(1), 'praised-cricket'],
    ['petNameForId(400042)', petNameForId(400042), 'lightened-sow'],
    ['petNameForId(999999)', petNameForId(999_999), 'musical-garpike'],
  ];
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(
        `BIJECTION DRIFT: ${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}. ` +
          'The wordlists or the encoder changed. Do NOT update these pins — stored pet_name ' +
          'values would disagree with freshly computed ones. This is a data migration.',
      );
    }
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply && dryRun) {
    console.error('Refusing to run: --dry-run and --apply are mutually exclusive.');
    process.exit(1);
  }
  if (!apply && !dryRun) {
    console.error('Refusing to run: pass --dry-run or --apply explicitly.');
    process.exit(1);
  }

  assertBijectionUnchanged();

  const rows = await prisma.$queryRaw<{ id: string; name: string | null }[]>(
    Prisma.sql`SELECT id::text, name FROM gcfs ORDER BY id`,
  );
  console.log(`fetched ${rows.length.toLocaleString()} gcfs`);

  const pairs: { id: string; pet: string }[] = [];
  const unparsed: string[] = [];
  for (const { id, name } of rows) {
    const pet = petNameForGcfName(name);
    if (pet) pairs.push({ id, pet });
    else unparsed.push(name ?? '(null)');
  }

  const distinct = new Set(pairs.map((p) => p.pet)).size;
  console.log(`derived ${pairs.length.toLocaleString()} aliases, ${distinct.toLocaleString()} distinct`);
  console.log(`unparsed names: ${unparsed.length}`);
  if (unparsed.length) console.log('  e.g.', unparsed.slice(0, 5).join(', '));

  if (distinct !== pairs.length) {
    throw new Error('COLLISION: derived aliases are not unique — aborting before any write.');
  }
  if (!apply) {
    console.log('dry run — no writes. Sample:');
    for (const p of pairs.slice(0, 5)) console.log(`  ${p.id} -> ${p.pet}`);
    return;
  }

  let written = 0;
  let skipped = 0;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const chunk = pairs.slice(i, i + BATCH);
    const values = Prisma.join(
      chunk.map((p) => Prisma.sql`(${p.id}::uuid, ${p.pet})`),
    );
    // IS DISTINCT FROM makes a resumed run (e.g. after statement_timeout) touch only missing rows.
    const n = await prisma.$executeRaw(Prisma.sql`
      UPDATE gcfs SET pet_name = v.pet
      FROM (VALUES ${values}) AS v(id, pet)
      WHERE gcfs.id = v.id
        AND gcfs.pet_name IS DISTINCT FROM v.pet
    `);
    // Fewer rows than the chunk is a resume; more means a duplicate id match.
    if (n > chunk.length) {
      throw new Error(
        `Batch at offset ${i} updated ${n} rows from a ${chunk.length}-row chunk — duplicate id match, aborting.`,
      );
    }
    written += n;
    skipped += chunk.length - n;
    console.log(
      `  ${Math.min(i + BATCH, pairs.length).toLocaleString()} / ${pairs.length.toLocaleString()}` +
        ` — ${n.toLocaleString()} written, ${(chunk.length - n).toLocaleString()} already correct`,
    );
  }
  console.log(
    `done: ${written.toLocaleString()} written, ${skipped.toLocaleString()} already correct`,
  );

  // Affected-row counts can't prove the column is full (deleted rows count as
  // "already correct"), so verify against the table.
  const [check] = await prisma.$queryRaw<
    { total: bigint; populated: bigint; distinct_names: bigint }[]
  >(Prisma.sql`
    SELECT count(*) AS total,
           count(pet_name) AS populated,
           count(DISTINCT pet_name) AS distinct_names
    FROM gcfs
  `);
  const { total, populated, distinct_names: distinctNames } = check;
  console.log(
    `verified: ${populated.toLocaleString()} / ${total.toLocaleString()} populated, ` +
      `${distinctNames.toLocaleString()} distinct`,
  );
  if (populated !== total || distinctNames !== total) {
    throw new Error(
      `VERIFICATION FAILED: ${total} rows, ${populated} populated, ${distinctNames} distinct. ` +
        'Re-run to fill the gap — the update is idempotent.',
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
