import threading

from scripts.mgnify_v2_crawl.state import ResumeLog


def test_mark_ok_makes_is_done_true():
    log = ResumeLog(":memory:")
    assert log.is_done("samples", "ERS1") is False
    log.mark("samples", "ERS1", "ok", http=200)
    assert log.is_done("samples", "ERS1") is True


def test_mark_error_keeps_is_done_false():
    log = ResumeLog(":memory:")
    log.mark("samples", "ERS2", "error", http=500)
    assert log.is_done("samples", "ERS2") is False


def test_error_then_ok_promotes_to_done():
    log = ResumeLog(":memory:")
    log.mark("runs", "ERR1", "error", http=503)
    assert log.is_done("runs", "ERR1") is False
    log.mark("runs", "ERR1", "ok", http=200)
    assert log.is_done("runs", "ERR1") is True


def test_re_mark_ok_is_idempotent():
    log = ResumeLog(":memory:")
    log.mark("studies", "MGYS1", "ok", http=200)
    log.mark("studies", "MGYS1", "ok", http=200)  # upsert, not a duplicate row
    assert log.is_done("studies", "MGYS1") is True
    assert log.done_keys("studies") == {"MGYS1"}


def test_done_keys_round_trips_a_set():
    log = ResumeLog(":memory:")
    log.mark("samples", "A", "ok")
    log.mark("samples", "B", "ok")
    log.mark("samples", "C", "error")  # not ok -> excluded
    assert log.done_keys("samples") == {"A", "B"}


def test_done_keys_empty_when_none_done():
    log = ResumeLog(":memory:")
    assert log.done_keys("samples") == set()


def test_entity_types_do_not_collide():
    log = ResumeLog(":memory:")
    log.mark("samples", "X", "ok")
    log.mark("assemblies", "X", "error")
    assert log.is_done("samples", "X") is True
    assert log.is_done("assemblies", "X") is False
    assert log.done_keys("samples") == {"X"}
    assert log.done_keys("assemblies") == set()


def test_http_is_optional():
    log = ResumeLog(":memory:")
    log.mark("biomes", "root", "ok")
    assert log.is_done("biomes", "root") is True


def test_concurrent_marks_from_many_threads_lose_nothing(tmp_path):
    # The phases share one ResumeLog across a thread pool; every write must land.
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    n_threads = 8
    per_thread = 200
    errors = []

    def worker(t):
        try:
            for i in range(per_thread):
                log.mark("samples", f"t{t}-k{i}", "ok", http=200)
        except Exception as exc:  # noqa: BLE001 - surface any DB race
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(n_threads)]
    for thr in threads:
        thr.start()
    for thr in threads:
        thr.join()

    assert errors == []
    expected = {f"t{t}-k{i}" for t in range(n_threads) for i in range(per_thread)}
    assert log.done_keys("samples") == expected
    assert len(log.done_keys("samples")) == n_threads * per_thread


def test_persists_to_disk_and_creates_parent_dir(tmp_path):
    db_path = tmp_path / "nested" / "_state" / "crawl.sqlite"
    log = ResumeLog(str(db_path))
    log.mark("samples", "ERS9", "ok", http=200)
    assert db_path.exists()
    reopened = ResumeLog(str(db_path))
    assert reopened.is_done("samples", "ERS9") is True
    assert reopened.done_keys("samples") == {"ERS9"}
