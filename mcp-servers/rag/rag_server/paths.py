"""Where this server keeps its on-disk state.

Reuses coworker's own `state_dir()` convention (same one `browser_logins.py` and
`secrets.py` use) so everything this app writes lives under one place — must run in the
same Python environment as `coworker` (see README), same requirement as `browser-pool`.
"""

from __future__ import annotations

from pathlib import Path

try:
    from coworker.secrets import state_dir
except ImportError as exc:  # pragma: no cover - setup-time failure, not a runtime path
    raise RuntimeError(
        "rag-server must run in the same environment as the `coworker` package "
        "(import coworker.secrets failed) — install into coworker's venv, or add "
        "the openworker repo root to PYTHONPATH."
    ) from exc


def collection_dir(collection: str) -> Path:
    d = state_dir() / "vector-index" / collection
    d.mkdir(parents=True, exist_ok=True)
    return d


def lancedb_uri(collection: str) -> str:
    return str(collection_dir(collection) / "lancedb")


def sqlite_path(collection: str) -> Path:
    return collection_dir(collection) / "fallback.sqlite3"
