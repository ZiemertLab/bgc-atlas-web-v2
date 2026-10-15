"""SQLite-backed resume log. Only ``status == "ok"`` counts as done; other rows are retried."""

import os
import sqlite3
import threading
from datetime import datetime, timezone

_SCHEMA = """
CREATE TABLE IF NOT EXISTS crawl (
    entity_type TEXT NOT NULL,
    key         TEXT NOT NULL,
    status      TEXT NOT NULL,
    http        INTEGER,
    ts          TEXT NOT NULL,
    PRIMARY KEY (entity_type, key)
)
"""


class ResumeLog:
    def __init__(self, db_path):
        if db_path != ":memory:":
            parent = os.path.dirname(db_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
        # check_same_thread=False adds no serialization; _lock guards every execute+commit.
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        if db_path != ":memory:":
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(_SCHEMA)
        self._conn.commit()

    def mark(self, entity_type, key, status, http=None):
        ts = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO crawl (entity_type, key, status, http, ts)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(entity_type, key) DO UPDATE SET
                    status = excluded.status,
                    http   = excluded.http,
                    ts     = excluded.ts
                """,
                (entity_type, key, status, http, ts),
            )
            self._conn.commit()

    def is_done(self, entity_type, key) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM crawl WHERE entity_type = ? AND key = ? AND status = 'ok'",
                (entity_type, key),
            ).fetchone()
        return row is not None

    def done_keys(self, entity_type) -> set:
        with self._lock:
            rows = self._conn.execute(
                "SELECT key FROM crawl WHERE entity_type = ? AND status = 'ok'",
                (entity_type,),
            ).fetchall()
        return {r[0] for r in rows}

    def close(self):
        self._conn.close()
