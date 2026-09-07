"""Turn parsed documents into retrievable chunks with citation metadata.

Word-count windows are used instead of an exact tokenizer — one fewer dependency, and
close enough for chunk-sizing purposes (this governs retrieval granularity, not billing).

PDF chunks never span pages: each page is windowed independently, so every chunk has
exactly one page number to cite. Most pages are far under the window size and become a
single chunk; only unusually dense pages actually get split.

Excel chunks are per-sheet row-groups, and every chunk's text is prefixed with its
column headers — a chunk with data but no header context is not useful for retrieval
or for citing back to the user.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

WINDOW_WORDS = 512
OVERLAP_WORDS = 50
EXCEL_ROWS_PER_CHUNK = 50


@dataclass
class Chunk:
    text: str
    metadata: dict[str, Any]


def _base_metadata(source_type: str, filename: str) -> dict[str, Any]:
    """A uniform column set for every chunk regardless of source type — LanceDB (like
    any columnar store) infers a table's schema from the first batch written, so a
    PDF-shaped row (page) and an Excel-shaped row (sheet/row_start/row_end) can't be
    mixed in one collection unless every row carries the same fields. Sentinels (-1,
    "") stand in for "not applicable", not real values."""
    return {
        "source_type": source_type,
        "filename": filename,
        "page": -1,
        "sheet": "",
        "row_start": -1,
        "row_end": -1,
    }


def _windows(words: list[str], size: int, overlap: int) -> list[list[str]]:
    if not words:
        return []
    if len(words) <= size:
        return [words]
    step = max(1, size - overlap)
    out = []
    i = 0
    while i < len(words):
        out.append(words[i : i + size])
        if i + size >= len(words):
            break
        i += step
    return out


def chunk_pdf_pages(pages: list, *, filename: str) -> list[Chunk]:
    """`pages`: list of parsing.PdfPage."""
    chunks: list[Chunk] = []
    for page in pages:
        words = page.text.split()
        for window in _windows(words, WINDOW_WORDS, OVERLAP_WORDS):
            text = " ".join(window).strip()
            if not text:
                continue
            metadata = _base_metadata("pdf", filename)
            metadata["page"] = page.page_num
            chunks.append(Chunk(text=text, metadata=metadata))
    return chunks


def chunk_excel_sheets(sheets: list, *, filename: str) -> list[Chunk]:
    """`sheets`: list of parsing.ExcelSheet."""
    chunks: list[Chunk] = []
    for sheet in sheets:
        frame = sheet.frame
        header = " | ".join(sheet.columns)
        for start in range(0, len(frame), EXCEL_ROWS_PER_CHUNK):
            block = frame.iloc[start : start + EXCEL_ROWS_PER_CHUNK]
            if block.empty:
                continue
            rows_text = "\n".join(
                " | ".join(str(v) for v in row) for row in block.itertuples(index=False)
            )
            text = f"[{sheet.name}] columns: {header}\n{rows_text}"
            metadata = _base_metadata("excel", filename)
            metadata["sheet"] = sheet.name
            metadata["row_start"] = int(block.index[0])
            metadata["row_end"] = int(block.index[-1])
            chunks.append(Chunk(text=text, metadata=metadata))
    return chunks
