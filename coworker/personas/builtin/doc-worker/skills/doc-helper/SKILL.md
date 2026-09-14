---
name: doc-helper
description: Cheap first read on a Word/PDF document (excerpt + heading outline), and a plain Markdown -> Word converter for the final deliverable. Not for Excel — use query_spreadsheet instead.
---
Run the bundled script with `uv run <resources_path>/doc_helper.py <command> ...` — `uv`
resolves its three dependencies (python-docx, pypdf, pdfplumber) in an ephemeral
environment on first run; nothing gets installed into your own environment.

**Skim a document first, before reaching for full RAG ingestion:**

```
uv run <resources_path>/doc_helper.py skim <path/to/file.docx-or.pdf> [--budget-tokens 3000]
```

Returns JSON with two things in one call: `excerpt` (roughly the first N tokens of the
actual text, char-count estimate) and `outline` (the document's headings/structure —
paragraph styles for Word, a font-size heuristic for PDF). Read both together: if the
excerpt already answers what you need, you're done — cheap and fast. If it doesn't, the
outline tells you where in the document to look, or that this isn't the right document
at all. Only escalate to `rag_ingest_document` + `rag_search` when the document is long,
you need precise/repeated search over it, or the skim genuinely isn't enough — don't
reach for the heavier tool as your first move on a short file.

Excel (.xlsx/.xlsm) is out of scope for this script — it's already structured data, go
straight to `rag_ingest_document` + `query_spreadsheet`.

**Writing the final deliverable as a Word document** (only when asked for Word, not by
default — Markdown just needs `write_file`):

```
uv run <resources_path>/doc_helper.py write-docx <path/to/report.md> --out <path/to/report.docx>
```

Converts `#`/`##`/`###` headings, `-`/`*` bullets, and `**bold**`/`*italic*` inline
formatting into a real Word document. It is deliberately simple, not a full Markdown
implementation — tables aren't converted (the script reports what it skipped) and
anything unusual in the draft is worth a quick look at the output before handing it
back. Flag anything that didn't translate cleanly rather than silently dropping it.
