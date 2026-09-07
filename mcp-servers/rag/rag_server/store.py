"""Vector store — LanceDB primary, plain-SQLite linear-scan fallback.

Embedded either way: no server process, just files on disk under
paths.collection_dir(). If `lancedb` isn't installed, `_lancedb_available` is False and
every call below transparently falls through to the SQLite path — documented as fine at
the scale a personal research corpus actually reaches (hundreds to a few thousand
chunks), not meant to scale past that. Mirrors the same optional-dependency-with-
graceful-fallback pattern already used for Playwright in coworker's own
connectors/browser_automation.py.
"""

from __future__ import annotations

import json
import sqlite3
import struct
from typing import Any, Optional

import numpy as np

from . import paths

try:
    import lancedb

    _lancedb_available = True
except ImportError:
    _lancedb_available = False

# One connection per collection, cached and reused — not reopened on every call.
# lancedb.connect() spins up its own Rust/tokio async runtime under the hood; this
# server is a single long-lived MCP subprocess (unlike the short scripts used to test
# it), so reconnecting per call means one more never-released runtime per tool call
# for the life of the process. Small, finite cache: one entry per collection actually
# used, not one per call.
_lancedb_conns: dict[str, Any] = {}


def _lancedb_db(collection: str):
    conn = _lancedb_conns.get(collection)
    if conn is None:
        conn = lancedb.connect(paths.lancedb_uri(collection))
        _lancedb_conns[collection] = conn
    return conn


def add_chunks(collection: str, rows: list[dict[str, Any]]) -> int:
    """`rows`: [{"text", "vector", **metadata}, ...]. Returns rows added."""
    if not rows:
        return 0
    if _lancedb_available:
        return _lancedb_add(collection, rows)
    return _sqlite_add(collection, rows)


def search(collection: str, query_vector: list[float], k: int) -> list[dict[str, Any]]:
    if _lancedb_available:
        return _lancedb_search(collection, query_vector, k)
    return _sqlite_search(collection, query_vector, k)


def count(collection: str) -> int:
    if _lancedb_available:
        return _lancedb_count(collection)
    return _sqlite_count(collection)


# -- LanceDB path -------------------------------------------------------------------


def _lancedb_table(collection: str):
    """Open the table, or None if it doesn't exist yet — never creates one."""
    db = _lancedb_db(collection)
    if "chunks" not in db.table_names():
        return None
    return db.open_table("chunks")


def _lancedb_add(collection: str, rows: list[dict[str, Any]]) -> int:
    db = _lancedb_db(collection)
    if "chunks" in db.table_names():
        db.open_table("chunks").add(rows)
    else:
        db.create_table("chunks", data=rows)
    return len(rows)


def _lancedb_search(collection: str, query_vector: list[float], k: int) -> list[dict[str, Any]]:
    tbl = _lancedb_table(collection)
    if tbl is None:
        return []
    results = tbl.search(query_vector).limit(k).to_list()
    for r in results:
        r.pop("vector", None)
        r.pop("_distance", None)
    return results


def _lancedb_count(collection: str) -> int:
    tbl = _lancedb_table(collection)
    return tbl.count_rows() if tbl is not None else 0


# -- SQLite fallback path -------------------------------------------------------------


def _sqlite_conn(collection: str) -> sqlite3.Connection:
    conn = sqlite3.connect(paths.sqlite_path(collection))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "text TEXT NOT NULL, "
        "vector BLOB NOT NULL, "
        "metadata TEXT NOT NULL)"
    )
    return conn


def _pack(vector: list[float]) -> bytes:
    return struct.pack(f"{len(vector)}f", *vector)


def _unpack(blob: bytes) -> np.ndarray:
    n = len(blob) // 4
    return np.array(struct.unpack(f"{n}f", blob), dtype=np.float32)


def _sqlite_add(collection: str, rows: list[dict[str, Any]]) -> int:
    conn = _sqlite_conn(collection)
    try:
        for row in rows:
            vector = row["vector"]
            text = row["text"]
            metadata = {k: v for k, v in row.items() if k not in ("vector", "text")}
            conn.execute(
                "INSERT INTO chunks (text, vector, metadata) VALUES (?, ?, ?)",
                (text, _pack(vector), json.dumps(metadata)),
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def _sqlite_search(collection: str, query_vector: list[float], k: int) -> list[dict[str, Any]]:
    conn = _sqlite_conn(collection)
    try:
        rows = conn.execute("SELECT text, vector, metadata FROM chunks").fetchall()
    finally:
        conn.close()
    if not rows:
        return []
    q = np.array(query_vector, dtype=np.float32)
    q_norm = np.linalg.norm(q) or 1.0
    scored = []
    for text, blob, metadata_json in rows:
        v = _unpack(blob)
        v_norm = np.linalg.norm(v) or 1.0
        cosine = float(np.dot(q, v) / (q_norm * v_norm))
        scored.append((cosine, text, json.loads(metadata_json)))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [{"text": text, **metadata} for _, text, metadata in scored[:k]]


def _sqlite_count(collection: str) -> int:
    conn = _sqlite_conn(collection)
    try:
        return conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    finally:
        conn.close()
