from scripts.populator.tools.extract_facets_shard import chunk_runs


def test_round_robin_balances_and_preserves_all():
    runs = [f"r{i}" for i in range(10)]
    chunks = chunk_runs(runs, 3)
    assert len(chunks) == 3
    assert sorted(r for c in chunks for r in c) == sorted(runs)
    # round-robin -> sizes differ by at most 1
    sizes = sorted(len(c) for c in chunks)
    assert sizes[-1] - sizes[0] <= 1


def test_more_chunks_than_runs_drops_empties():
    chunks = chunk_runs(["a", "b"], 10)
    assert chunks == [["a"], ["b"]]


def test_single_chunk():
    assert chunk_runs(["a", "b", "c"], 1) == [["a", "b", "c"]]
