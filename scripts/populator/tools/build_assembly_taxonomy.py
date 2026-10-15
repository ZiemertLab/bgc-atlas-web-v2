"""Rebuild `assembly_taxonomy`: one resolved lineage per genome.

Taxonomy is stored per BGC; counting genomes per lineage directly double-counts
genomes whose BGCs disagree.

Resolution (resolve_genome):
  1. A genome-derived method (gtdb_r232 / gtdb_legacy) wins verbatim.
  2. Otherwise a nested strict majority, rank by rank, over the BGCs still
     matching the accepted prefix. Nulls stay in the denominator; ties fail.

A genome that resolves to nothing gets no row (readers LEFT JOIN). d__Unknown
counts as unclassified.

Usage:
    # dry run (default -- NO writes), full report:
    DATABASE_URL='postgresql://bgc_owner:...@localhost:5432/bgc_atlas_v2' \
        scripts/populator/.venv/bin/python -m scripts.populator.tools.build_assembly_taxonomy

    # rebuild the table (TRUNCATE + COPY in one transaction) and run the gates:
    DATABASE_URL=... scripts/populator/.venv/bin/python \
        -m scripts.populator.tools.build_assembly_taxonomy --apply
"""
import argparse
import collections
import csv
import io
import os
import sys
from typing import Dict, Iterable, List, NamedTuple, Optional, Sequence, Tuple

import psycopg2

# Methods where GTDB classified the genome itself, not a per-BGC prediction.
GENOME_METHODS = frozenset({"gtdb_r232", "gtdb_legacy"})

CONSENSUS_METHOD = "consensus_v1"

RANK_NAMES: Tuple[str, ...] = (
    "domain", "phylum", "class", "order", "family", "genus", "species",
)

# Compared lowercased.
UNCLASSIFIED_DOMAINS = frozenset({"d__unknown"})

# Must match the schema and both readers.
GENOME_SOURCE_TYPES = ("isolate", "MAG", "SAG")

# LEFT JOINs keep BGCs with no taxonomy so n_bgcs is the true BGC count; ORDER BY
# lets the build stream one genome at a time.
_SCAN_SQL = f"""
    SELECT b.assembly,
           bt.method,
           t.id,
           t.domain, t.phylum, t.class, t.order_name, t.family, t.genus, t.species,
           count(*)::int AS n
    FROM bgcs b
    JOIN assemblies a ON a.id = b.assembly AND a.source_type IN {GENOME_SOURCE_TYPES!r}
    LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
    LEFT JOIN taxonomies  t  ON t.id = bt.taxonomy_id
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    ORDER BY 1
"""

_TOTAL_GENOMES_SQL = f"""
    SELECT count(*)::bigint FROM assemblies WHERE source_type IN {GENOME_SOURCE_TYPES!r}
"""

# Lets a consensus truncated to a prefix still carry a taxonomy_id when known.
_LINEAGE_INDEX_SQL = "SELECT gtdb_lineage, id FROM taxonomies"

# --check: staleness signals that avoid scanning bgcs. `built_through` is the
# newest genome with a row. A "rowless genome with a genome-derived BGC" check
# was left out: its EXISTS into bgcs makes the planner sort the whole corpus.
_CHECK_SQL = f"""
    WITH watermark AS (
      SELECT max(a.created_at) AS built_through
      FROM assemblies a JOIN assembly_taxonomy at ON at.assembly_id = a.id
    )
    SELECT
      (SELECT count(*) FROM assembly_taxonomy) AS rows_present,
      (SELECT built_through FROM watermark) AS built_through,
      (SELECT count(*) FROM assemblies a
         WHERE a.source_type IN {GENOME_SOURCE_TYPES!r}
           AND NOT EXISTS (SELECT 1 FROM assembly_taxonomy at WHERE at.assembly_id = a.id)
      ) AS genomes_without_row,
      (SELECT count(*) FROM assemblies a, watermark w
         WHERE a.source_type IN {GENOME_SOURCE_TYPES!r}
           AND NOT EXISTS (SELECT 1 FROM assembly_taxonomy at WHERE at.assembly_id = a.id)
           AND a.created_at > w.built_through
      ) AS genomes_newer_than_build,
      (SELECT count(*) FROM assembly_taxonomy at
         WHERE NOT EXISTS (SELECT 1 FROM assemblies a
                            WHERE a.id = at.assembly_id AND a.source_type IN {GENOME_SOURCE_TYPES!r})
      ) AS orphan_rows,
      (SELECT COALESCE(SUM(n_bgcs), 0) FROM assembly_taxonomy) AS attributed_bgcs,
      (SELECT COALESCE(SUM(bgc_count), 0) FROM source_type_statistics
         WHERE source_type IN {GENOME_SOURCE_TYPES!r}) AS corpus_bgcs
"""

# Sampled: the exhaustive form is the rebuild's own scan. 2,000 rows take ~4s.
_SAMPLE_SQL = """
    WITH s AS (
      SELECT assembly_id, n_bgcs FROM assembly_taxonomy TABLESAMPLE SYSTEM (0.3) LIMIT %s
    )
    SELECT count(*) AS checked,
           count(*) FILTER (
             WHERE s.n_bgcs <> (SELECT count(*) FROM bgcs b WHERE b.assembly = s.assembly_id)
           ) AS mismatched
    FROM s
"""

COPY_COLUMNS = (
    "assembly_id", "taxonomy_id",
    "domain", "phylum", "class", "order_name", "family", "genus", "species",
    "rank", "method", "n_bgcs", "n_voting", "agreement",
)


class LineageRow(NamedTuple):
    method: Optional[str]
    ranks: Tuple[Optional[str], ...]   # 7 values, domain -> species
    taxonomy_id: Optional[str]
    n: int


class Resolution(NamedTuple):
    ranks: Tuple[Optional[str], ...]
    rank: str
    method: str
    taxonomy_id: Optional[str]
    n_bgcs: int
    n_voting: int
    agreement: Optional[float]


def is_classified(ranks: Sequence[Optional[str]]) -> bool:
    domain = ranks[0]
    return bool(domain) and domain.strip().lower() not in UNCLASSIFIED_DOMAINS


def lineage_string(accepted: Sequence[str]) -> str:
    return ";".join(accepted)


def nested_majority(
    voters: Sequence[Tuple[Tuple[Optional[str], ...], int]],
) -> Tuple[List[str], int]:
    """Walk domain -> species keeping each rank only on a strict majority.

    ``voters`` is a sequence of (ranks, n). Returns (accepted values, BGCs
    backing the deepest accepted rank), or ([], 0) when the domain has no majority.

    The denominator at each rank is the surviving set (BGCs matching every rank
    accepted so far), so a minority disagreement at domain does not stall descent.
    """
    accepted: List[str] = []
    surviving = list(voters)
    backing = sum(n for _, n in surviving)

    for depth in range(len(RANK_NAMES)):
        surviving_total = sum(n for _, n in surviving)
        tally: "collections.Counter[str]" = collections.Counter()
        for ranks, n in surviving:
            value = ranks[depth]
            if value is not None:
                tally[value] += n
        if not tally:
            break

        top, count = tally.most_common(1)[0]
        # Strict majority, so ties are never kept and most_common's tiebreak can't leak in.
        if count * 2 <= surviving_total:
            break

        accepted.append(top)
        backing = count
        surviving = [(ranks, n) for ranks, n in surviving if ranks[depth] == top]

    return accepted, backing


def resolve_genome(
    rows: Sequence[LineageRow],
    lineage_index: Optional[Dict[str, str]] = None,
) -> Tuple[Optional[Resolution], bool]:
    """Resolve one genome's rows to a single lineage, or (None, ...) for no row.

    The conflict flag is True when the genome carries more than one distinct
    genome-derived lineage, which should be impossible; the modal one is taken
    so a single bad genome cannot abort the build.
    """
    lineage_index = lineage_index or {}
    n_bgcs = sum(r.n for r in rows)
    classified = [r for r in rows if is_classified(r.ranks)]
    n_voting = sum(r.n for r in classified)

    if not classified:
        return None, False

    genome_derived = [r for r in classified if r.method in GENOME_METHODS]
    if genome_derived:
        by_lineage: "collections.Counter[Tuple[Optional[str], ...]]" = collections.Counter()
        for row in genome_derived:
            by_lineage[row.ranks] += row.n
        conflict = len(by_lineage) > 1
        # Deterministic tiebreak; None sorts last since comparing it to str raises.
        ranks = max(
            by_lineage,
            key=lambda k: (by_lineage[k], tuple((v is None, v or "") for v in k)),
        )
        taxonomy_id = next(r.taxonomy_id for r in genome_derived if r.ranks == ranks)
        method = next(r.method for r in genome_derived if r.ranks == ranks)
        # Deepest named rank, not the count of named ranks, so a holed lineage is
        # rejected by the dense_prefix CHECK rather than mislabelled.
        depth = max(i for i, value in enumerate(ranks) if value is not None) + 1
        return Resolution(
            ranks=ranks,
            rank=RANK_NAMES[depth - 1],
            method=method,
            taxonomy_id=taxonomy_id,
            n_bgcs=n_bgcs,
            n_voting=n_voting,
            agreement=None,
        ), conflict

    accepted, backing = nested_majority([(r.ranks, r.n) for r in classified])
    if not accepted:
        return None, False

    ranks = tuple(accepted) + (None,) * (len(RANK_NAMES) - len(accepted))
    return Resolution(
        ranks=ranks,
        rank=RANK_NAMES[len(accepted) - 1],
        method=CONSENSUS_METHOD,
        taxonomy_id=lineage_index.get(lineage_string(accepted)),
        n_bgcs=n_bgcs,
        n_voting=n_voting,
        agreement=backing / n_voting,
    ), False


def group_rows(cursor: Iterable[tuple]) -> Iterable[Tuple[str, List[LineageRow]]]:
    """Yield (assembly_id, rows); relies on the scan's ORDER BY assembly."""
    current: Optional[str] = None
    batch: List[LineageRow] = []
    for assembly, method, taxonomy_id, *ranks, n in cursor:
        assembly = str(assembly)
        if assembly != current:
            if current is not None:
                yield current, batch
            current, batch = assembly, []
        batch.append(LineageRow(
            method=method,
            ranks=tuple(ranks),
            taxonomy_id=str(taxonomy_id) if taxonomy_id else None,
            n=n,
        ))
    if current is not None:
        yield current, batch


def _connect(dbname: str):
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"],
        dbname=dbname,
    )


def run_check(cur, sample_size: int) -> bool:
    """Return True when no drift was detected."""
    cur.execute(_CHECK_SQL)
    (rows_present, built_through, without_row, newer_than_build,
     orphans, attributed, corpus) = cur.fetchone()
    cur.execute(_SAMPLE_SQL, (sample_size,))
    checked, mismatched = cur.fetchone()

    print(f"rows present:              {rows_present:,}", flush=True)
    print(f"built through:             {built_through}", flush=True)
    print(f"genomes with no row:       {without_row:,}   "
          f"(unresolved + genomes with no BGC; both legitimate)", flush=True)
    print(f"BGCs attributed:           {attributed:,} of {corpus:,} "
          f"({corpus - attributed:,} on genomes with no row)", flush=True)
    print("", flush=True)

    stale = False
    for label, value in (
        ("genomes ingested since the build", newer_than_build),
        ("orphan rows (genome gone or retyped)", orphans),
        (f"n_bgcs drift in a {checked:,}-row sample", mismatched),
    ):
        print(f"  [{'STALE' if value else 'ok'}] {label}: {value:,}", flush=True)
        stale = stale or bool(value)

    print("\nSTALE -- rebuild with --apply" if stale
          else "\nno drift detected", flush=True)
    return not stale


def _gate(label: str, got, expected) -> bool:
    ok = got == expected
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got:,}, expected {expected:,}",
          flush=True)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true",
                    help="TRUNCATE and rewrite assembly_taxonomy (default: dry run)")
    ap.add_argument("--check", action="store_true",
                    help="report staleness in seconds and exit 1 if stale; no rebuild")
    ap.add_argument("--sample-size", type=int, default=2000,
                    help="rows sampled for the n_bgcs drift check (default: 2000)")
    args = ap.parse_args()

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SELECT current_database()")
        db = cur.fetchone()[0]
        if db != args.dbname:
            print(f"ABORT: connected to '{db}', expected '{args.dbname}'. "
                  f"Set --dbname or fix DATABASE_URL.", file=sys.stderr)
            return 2
        print(f"connected to {db}", flush=True)

        # The app DSN's 120s statement cap is not meant for this offline ~16.5M-row scan.
        cur.execute("SET statement_timeout = '3600s'")
        cur.execute("SET work_mem = '64MB'")

        if args.check:
            return 0 if run_check(cur, args.sample_size) else 1

        cur.execute(_TOTAL_GENOMES_SQL)
        total_genomes = int(cur.fetchone()[0])
        print(f"genome assemblies (isolate/MAG/SAG): {total_genomes:,}", flush=True)

        cur.execute(_LINEAGE_INDEX_SQL)
        lineage_index = {lineage: str(tid) for lineage, tid in cur.fetchall()}
        print(f"lineage index: {len(lineage_index):,} taxonomies rows", flush=True)

        print("scanning genome BGCs (this is the slow part, ~10 min)...", flush=True)
        scan = conn.cursor(name="assembly_taxonomy_scan")
        scan.itersize = 50_000
        scan.execute(_SCAN_SQL)

        rows_out: List[tuple] = []
        by_method: "collections.Counter[str]" = collections.Counter()
        by_rank: "collections.Counter[str]" = collections.Counter()
        by_phylum: "collections.Counter[str]" = collections.Counter()
        genomes_seen = 0
        unresolved = 0
        unresolved_no_taxonomy = 0    # no BGC carried a lineage at all
        unresolved_no_majority = 0    # lineages present, no majority even at domain
        conflicts = 0
        truncated = 0            # consensus rows that stopped above species
        agreement_sum = 0.0
        consensus_rows = 0

        for assembly, batch in group_rows(scan):
            genomes_seen += 1
            resolution, conflict = resolve_genome(batch, lineage_index)
            conflicts += int(conflict)
            if resolution is None:
                unresolved += 1
                if any(is_classified(row.ranks) for row in batch):
                    unresolved_no_majority += 1
                else:
                    unresolved_no_taxonomy += 1
                continue

            by_method[resolution.method] += 1
            by_rank[resolution.rank] += 1
            by_phylum[resolution.ranks[1] or "(domain only)"] += 1
            if resolution.method == CONSENSUS_METHOD:
                consensus_rows += 1
                agreement_sum += resolution.agreement or 0.0
                if resolution.rank != "species":
                    truncated += 1

            rows_out.append((
                assembly, resolution.taxonomy_id,
                *resolution.ranks,
                resolution.rank, resolution.method,
                resolution.n_bgcs, resolution.n_voting, resolution.agreement,
            ))
        scan.close()

        bgc_less = total_genomes - genomes_seen

        print(f"\ngenomes with >= 1 BGC:      {genomes_seen:,}", flush=True)
        print(f"genomes with no BGC at all: {bgc_less:,}", flush=True)
        print(f"resolved (rows to write):   {len(rows_out):,}", flush=True)
        print(f"unresolved (no row):        {unresolved:,}", flush=True)
        print(f"  no BGC carried a lineage: {unresolved_no_taxonomy:,}", flush=True)
        print(f"  no majority at domain:    {unresolved_no_majority:,}", flush=True)

        print("\nby method:", flush=True)
        for method, n in by_method.most_common():
            print(f"  {method:<14} {n:,}", flush=True)

        print("\nby resolved rank:", flush=True)
        for rank in RANK_NAMES:
            if by_rank[rank]:
                print(f"  {rank:<14} {by_rank[rank]:,}", flush=True)

        if consensus_rows:
            print(f"\nconsensus rows:             {consensus_rows:,}", flush=True)
            print(f"  stopped above species:    {truncated:,} "
                  f"({100.0 * truncated / consensus_rows:.1f}%)", flush=True)
            print(f"  mean agreement:           {agreement_sum / consensus_rows:.3f}",
                  flush=True)

        print("\ntop-10 phyla by genome count:", flush=True)
        for phylum, n in by_phylum.most_common(10):
            print(f"  {n:8,}  {phylum}", flush=True)

        print("\n--- gates ---", flush=True)
        all_ok = True
        all_ok &= _gate("resolved + unresolved + BGC-less == total genomes",
                        len(rows_out) + unresolved + bgc_less, total_genomes)
        all_ok &= _gate("genome-derived lineage conflicts", conflicts, 0)

        if not args.apply:
            print("\nDRY RUN -- nothing written. Re-run with --apply.", flush=True)
            return 0 if all_ok else 1

        if not all_ok:
            print("\nABORT: a pre-write gate failed; not writing.", file=sys.stderr)
            return 1

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerows(rows_out)
        buf.seek(0)

        cur.execute("TRUNCATE assembly_taxonomy")
        cur.copy_expert(
            f"COPY assembly_taxonomy ({', '.join(COPY_COLUMNS)}) FROM STDIN WITH (FORMAT csv)",
            buf,
        )
        conn.commit()
        print(f"\nwrote {len(rows_out):,} rows", flush=True)

        print("\n--- post-write gates ---", flush=True)
        cur.execute("SELECT count(*) FROM assembly_taxonomy")
        all_ok &= _gate("rows in table", int(cur.fetchone()[0]), len(rows_out))

        # Every genome lands in exactly one bucket; this is the sunburst's centre total.
        cur.execute(f"""
            SELECT count(*)::bigint
            FROM assemblies a
            LEFT JOIN assembly_taxonomy at ON at.assembly_id = a.id
            WHERE a.source_type IN {GENOME_SOURCE_TYPES!r}
        """)
        all_ok &= _gate("sunburst genome total", int(cur.fetchone()[0]), total_genomes)

        # The regression gate: a genome whose BGCs carry genome-derived taxonomy
        # (GTDB, replicated onto every BGC) must resolve to exactly that lineage.
        # Scoped to those BGCs, not to every isolate/SAG: OMD-v2 reference genomes and
        # SPIRE specI isolates are isolates whose BGCs carry per-BGC predictions
        # (orf_lca_v1), where a consensus that differs from some BGCs is the expected answer.
        cur.execute("""
            SELECT count(*)::bigint
            FROM assembly_taxonomy at
            JOIN assemblies a ON a.id = at.assembly_id
            WHERE a.source_type IN ('isolate', 'SAG')
              AND EXISTS (
                SELECT 1
                FROM bgcs b
                JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
                JOIN taxonomies t ON t.id = bt.taxonomy_id
                WHERE b.assembly = a.id
                  AND bt.method IN ('gtdb_r232', 'gtdb_legacy')
                  AND (t.domain, t.phylum, t.class, t.order_name, t.family, t.genus, t.species)
                      IS DISTINCT FROM
                      (at.domain, at.phylum, at.class, at.order_name, at.family, at.genus, at.species)
              )
        """)
        all_ok &= _gate("isolate/SAG genomes whose lineage changed",
                        int(cur.fetchone()[0]), 0)

        print("\nALL GATES PASSED" if all_ok else "\nGATES FAILED", flush=True)
        return 0 if all_ok else 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
