"""filename -> original source path, per collection.

Chunks in the vector store carry a filename for citation, not a full path — this is the
small side-table that lets get_pdf_page_image/query_spreadsheet find the real file
again to re-open it (page images and spreadsheet queries need the actual document, not
just its indexed text).
"""

from __future__ import annotations

import json
import threading
from typing import Optional

from . import paths

_lock = threading.Lock()


def _manifest_path(collection: str):
    return paths.collection_dir(collection) / "sources.json"


def record(collection: str, filename: str, source_path: str) -> None:
    p = _manifest_path(collection)
    with _lock:
        data = {}
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {}
        data[filename] = source_path
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get(collection: str, filename: str) -> Optional[str]:
    p = _manifest_path(collection)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data.get(filename)
