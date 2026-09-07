"""PDF and Excel parsing.

PDFs go through LiteParse's own persistent worker pool. This matters for the same
reason argued for query_spreadsheet's sandbox: PDFium isn't thread-safe and CPython
can't safely force-kill a hung thread, so LiteParse itself parses in a pool of separate
processes and enforces `parse_timeout` by killing the worker — reuse that rather than
re-deriving a timeout scheme for "what if a rogue/malformed PDF hangs the parser".

Excel does NOT go through LiteParse's LibreOffice-based Office conversion — it's read
directly with pandas/openpyxl so real per-sheet/per-column structure survives. This
matters twice: header-aware chunking needs real tabular structure, and the
query_spreadsheet tool operates on the exact same DataFrames, not a second, divergent
parse of the same file.
"""

from __future__ import annotations

import atexit
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pandas as pd
from liteparse import LiteParse, ParseTimeoutError

_POOL_SIZE = int(os.environ.get("RAG_PARSE_POOL_SIZE", "2"))
_PARSE_TIMEOUT = int(os.environ.get("RAG_PARSE_TIMEOUT", "30"))
# OCR timeout scales with page count instead of using the flat _PARSE_TIMEOUT — a fixed
# 30s comfortably covers a clean digital PDF (208 pages parses in ~1s with OCR off, per
# this project's own testing against a real book) but is nowhere near enough once OCR
# is actually in play (the same 208-page book measured ~40s even with no OCR backend
# installed — real OCR via tesseract is typically slower still). 2s/page is a generous
# per-page budget; the min/max bound both a tiny scanned doc and a pathologically large
# one so this stays a real ceiling, not an unbounded wait.
_OCR_SECONDS_PER_PAGE = float(os.environ.get("RAG_OCR_SECONDS_PER_PAGE", "2.0"))
_MIN_OCR_TIMEOUT = int(os.environ.get("RAG_OCR_MIN_TIMEOUT", "60"))
_MAX_OCR_TIMEOUT = int(os.environ.get("RAG_OCR_MAX_TIMEOUT", "1800"))
# Deliberately 1, not _POOL_SIZE: OCR is already the rare, effectively-serial path (one
# document at a time triggers it), and it's the pool this document already pays the
# most for. Two OCR workers means two of these heavy processes resident at once, on
# top of the plain pool's own _POOL_SIZE workers already running — under a resource-
# constrained VM (WSL2's virtualized CPU/memory cap is a documented case) that's a real
# contributor to system-wide pressure, not just this process's own footprint.
_OCR_POOL_SIZE = int(os.environ.get("RAG_OCR_POOL_SIZE", "1"))

# The plain (OCR-off) pool is the common case — most PDFs are clean/digital — and is
# cheap enough to build once and reuse. The OCR pool is rebuilt per document instead:
# its timeout depends on that document's page count (see above), and LiteParse's own
# docs note pool startup is ~60ms — negligible next to an OCR job that can run minutes.
_pool_plain: Optional[LiteParse] = None


def _plain_pool() -> LiteParse:
    global _pool_plain
    if _pool_plain is None:
        _pool_plain = LiteParse(
            pool_size=_POOL_SIZE,
            parse_timeout=_PARSE_TIMEOUT,
            ocr_enabled=False,
            output_format="markdown",
            quiet=True,
        )
    return _pool_plain


def _ocr_timeout_for(page_count: int) -> int:
    return min(_MAX_OCR_TIMEOUT, max(_MIN_OCR_TIMEOUT, int(page_count * _OCR_SECONDS_PER_PAGE)))


def _build_ocr_pool(timeout: int) -> LiteParse:
    return LiteParse(
        pool_size=_OCR_POOL_SIZE,
        parse_timeout=timeout,
        ocr_enabled=True,
        output_format="markdown",
        quiet=True,
    )


@atexit.register
def _close_pools() -> None:
    """Explicit shutdown before interpreter finalization — LiteParse's own pool
    cleanup (`__del__` -> `_close_pipes`) can race daemon threads during teardown
    otherwise (observed as a fatal error at process exit in this session's testing)."""
    global _pool_plain
    for pool in (_pool_plain,):
        if pool is not None:
            try:
                pool.close()
            except Exception:
                pass
    _pool_plain = None
    _pool_ocr = None


@dataclass
class PdfPage:
    page_num: int
    text: str


@dataclass
class PdfParseResult:
    pages: list[PdfPage]
    total_pages: int
    ocr_used: bool
    error: Optional[str] = None


def parse_pdf(path: str, ocr: bool = True) -> PdfParseResult:
    """Page-aware markdown text.

    `ocr=True` (default): OCR is enabled only when a cheap is_complex() pass actually
    flags a page as needing it — most PDFs are clean/digital and skip OCR entirely,
    which is the expensive, resource-heavy path (a whole extra worker pool — see
    _build_ocr_pool's docstring on why that matters on a constrained machine).
    `ocr=False`: skip is_complex's OCR check entirely and always use the plain pool,
    regardless of what any page looks like — a hard, complete opt-out, not just a
    preference. Scanned/image-only pages will come back with little or no text; that's
    the tradeoff this flag exists to make explicit and controllable, not automatic."""
    if not ocr:
        try:
            result = _plain_pool().parse(path)
        except ParseTimeoutError as exc:
            return PdfParseResult(
                pages=[], total_pages=0, ocr_used=False,
                error=f"parse timed out after {exc.timeout}s — document may be malformed",
            )
        except Exception as exc:
            return PdfParseResult(pages=[], total_pages=0, ocr_used=False, error=str(exc))
        pages = [PdfPage(page_num=p.page_num, text=p.markdown or p.text or "") for p in result.pages]
        return PdfParseResult(pages=pages, total_pages=result.total_pages, ocr_used=False)

    try:
        complexity = _plain_pool().is_complex(path)
    except ParseTimeoutError as exc:
        return PdfParseResult(
            pages=[], total_pages=0, ocr_used=False,
            error=f"complexity check timed out after {exc.timeout}s — document may be malformed",
        )
    except Exception as exc:
        return PdfParseResult(pages=[], total_pages=0, ocr_used=False, error=str(exc))

    needs_ocr = any(p.needs_ocr for p in complexity)
    ocr_pool: Optional[LiteParse] = None
    pool = _plain_pool()
    if needs_ocr:
        ocr_pool = _build_ocr_pool(_ocr_timeout_for(len(complexity)))
        pool = ocr_pool
    try:
        result = pool.parse(path)
    except ParseTimeoutError as exc:
        return PdfParseResult(
            pages=[], total_pages=0, ocr_used=needs_ocr,
            error=f"parse timed out after {exc.timeout}s — document may be malformed",
        )
    except Exception as exc:
        return PdfParseResult(pages=[], total_pages=0, ocr_used=needs_ocr, error=str(exc))
    finally:
        if ocr_pool is not None:
            ocr_pool.close()

    pages = [PdfPage(page_num=p.page_num, text=p.markdown or p.text or "") for p in result.pages]
    return PdfParseResult(pages=pages, total_pages=result.total_pages, ocr_used=needs_ocr)


def screenshot_page(path: str, page_number: int) -> tuple[Optional[bytes], Optional[str]]:
    """(PNG bytes, None) on success, or (None, error message) — surfaced to the
    caller rather than collapsed to a bare None, so a real bug (like the
    parse_timeout/pool_size construction error caught during this project's own
    testing) doesn't silently read as "page doesn't exist"."""
    try:
        shots = LiteParse(
            ocr_enabled=False, quiet=True,
            pool_size=1, parse_timeout=_PARSE_TIMEOUT,
        ).screenshot(path, page_numbers=[page_number])
    except ParseTimeoutError as exc:
        return None, f"screenshot timed out after {exc.timeout}s"
    except Exception as exc:
        return None, str(exc)
    if not shots:
        return None, f"page {page_number} not found"
    return shots[0].image_bytes, None


@dataclass
class ExcelSheet:
    name: str
    columns: list[str]
    row_count: int
    frame: "pd.DataFrame" = field(repr=False)


def parse_excel(path: str) -> list[ExcelSheet]:
    """Every sheet as a real DataFrame — the same objects both chunking and
    query_spreadsheet operate on, so there is exactly one parse of a given file, not
    two divergent representations of it."""
    sheets = pd.read_excel(Path(path), sheet_name=None, engine="openpyxl")
    return [
        ExcelSheet(
            name=name, columns=[str(c) for c in frame.columns],
            row_count=len(frame), frame=frame,
        )
        for name, frame in sheets.items()
    ]
