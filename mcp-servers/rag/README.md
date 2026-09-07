# rag-server

Local RAG (retrieval-augmented generation) MCP server for PDFs and Excel files —
built for a personal research corpus (hundreds of documents), not a single ad-hoc
attachment. Parses once, chunks, embeds, and indexes to disk; retrieval returns small
relevant snippets instead of re-sending whole documents every turn.

Everything runs locally — no API keys, nothing leaves the device.

## Setup

**Must run in the same Python environment as `coworker`** — it imports
`coworker.secrets.state_dir` so its on-disk state lives alongside everything else
coworker keeps (secrets, browser logins, etc.).

```bash
cd mcp-servers/rag
pip install -e .
pip install -e ".[lancedb]"   # optional but recommended — see "Vector store" below
```

First use of embeddings/reranking downloads their ONNX models (~130MB total,
`BAAI/bge-small-en-v1.5` + `Xenova/ms-marco-MiniLM-L-6-v2`) from Hugging Face once;
after that, everything is offline.

## A note on `COWORKER_STATE_DIR`

If coworker itself runs with a custom `COWORKER_STATE_DIR` (a portable install, a
multi-account setup, tests), this server does **not** automatically inherit it —
spawned MCP servers only inherit a small safe allowlist of environment variables by
design (`mcp.client.stdio.get_default_environment`), not the full parent environment,
so a third-party server can't silently see secrets from the process that launched it.
If you're running with a custom state dir, pass it through explicitly in `mcp.json`:

```json
{
  "mcpServers": {
    "rag": {
      "command": "rag-server",
      "env": { "COWORKER_STATE_DIR": "${COWORKER_STATE_DIR}" }
    }
  }
}
```

Without this, the server silently falls back to the OS default (`~/.config/coworker`)
— harmless in the common case (no override set, both sides agree on the default), but
worth knowing before you go looking for data that "isn't there."

## Register with coworker

```json
{
  "mcpServers": {
    "rag": {
      "command": "rag-server"
    }
  }
}
```

## Tools

- `rag_ingest_folder(path, collection)` — bulk-index every PDF/Excel file in a folder
  (recursively). For an existing research library, not a single new file.
- `rag_ingest_document(collection, filename, content_base64)` — index one document,
  for a file that just entered a conversation.
- `rag_search(collection, query, k=5)` — two-stage retrieval (vector search, then
  cross-encoder rerank on the top candidates) with source citations (filename + page
  for PDFs, filename + sheet/rows for Excel).
- `get_pdf_page_image(collection, filename, page_number)` — render one PDF page as a
  PNG, for when extracted text looks garbled, table-shaped, or otherwise suspect.
  Read-only, no elevated risk.
- `query_spreadsheet(collection, filename, code)` — run pandas code against a
  previously ingested Excel file's sheets, for joins/aggregations semantic search
  can't compose. **The one tool here with real risk** — see "Sandboxing" below.

## Parsing

- **PDF**: [`liteparse`](https://github.com/run-llama/liteparse) — a persistent worker
  pool (`pool_size`/`parse_timeout`) parses in separate processes so a malformed/rogue
  PDF can't hang the server; `is_complex()` gates OCR to only the pages that actually
  need it (most PDFs are clean, digital text and skip OCR entirely).
- **Excel**: `pandas`/`openpyxl` directly, per sheet — NOT LiteParse's LibreOffice-based
  Office conversion, so real tabular structure survives for both header-aware chunking
  and `query_spreadsheet` (same DataFrame, one parse, not two divergent ones).

## Vector store

LanceDB (embedded, directory-based, no server) if installed; otherwise a plain SQLite
table with a linear cosine scan — correct, but only sized for hundreds to a few
thousand chunks, not meant to scale past that. Both live under
`state_dir()/vector-index/<collection>/`.

## Sandboxing (`query_spreadsheet`)

This is the only tool on this server that executes code, and it's treated accordingly:

- **Always runs in a separate OS process**, Docker container or plain subprocess,
  never in-process `exec()` — this is what makes a hang stoppable at all: CPython
  cannot safely force-kill a running thread, only a parent that can `SIGKILL` a child
  process can guarantee a timeout actually ends the execution. Verified in this
  project's own testing: a deliberate `while True: pass` gets killed at the timeout
  boundary in the subprocess tier.
- **Docker tier** (used automatically if `docker info` succeeds): `--network none`,
  memory/CPU caps, only the target file's directory reachable. Builds a small
  `rag-sandbox` image once (`docker/Dockerfile`, `python:3.12-slim` + `pandas`) — the
  only point this needs network access; every actual call after that runs offline.
- **Subprocess tier** (fallback, no Docker): a restricted-globals namespace (only `pd`
  and the loaded DataFrames are available — no `import` works at all, verified in
  testing) plus a parent-enforced timeout.
- **The restricted-globals layer is a soft control, not a hard boundary** — also
  verified directly in this project's testing: the classic
  `().__class__.__bases__[0].__subclasses__()` object-graph walk still reaches
  `subprocess.Popen` even with `__builtins__` stripped down to a small allowlist. It
  raises the bar against casual/unsophisticated misuse; it is not what makes this tool
  safe. **What makes it safe is that coworker treats every MCP tool as
  needs-approval by default** — do not add a local risk override that relaxes
  `query_spreadsheet` specifically, even though the other four tools on this server are
  reasonable to relax once trusted.
