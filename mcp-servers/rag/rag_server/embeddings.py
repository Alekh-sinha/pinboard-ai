"""Embeddings + reranking — fastembed, ONNX Runtime, CPU-only, no API key.

Both stages come from one library/runtime on purpose (one dependency to cover retrieval
end to end). Models lazy-load on first use (not at import time) so importing this
module never triggers a download — matches the lazy-heavy-import pattern used
throughout the rest of this codebase (Playwright, browser automation, etc.).
"""

from __future__ import annotations

import os
from typing import Optional

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"

# fastembed/onnxruntime defaults to one thread pool PER MODEL sized to every CPU core
# it can see (threads=None). Two models (embedder + reranker) each claiming every core
# is a real problem under a resource-constrained VM (WSL2's virtualized CPU/memory cap
# is a documented case) — competing full-core thread pools plus whatever LiteParse
# worker processes are also resident is a plausible way to pin/starve the whole VM, not
# just this process. Bounded and env-configurable rather than left to the runtime's
# own "use everything" default.
_ONNX_THREADS = int(os.environ.get("RAG_ONNX_THREADS", "4"))

_embedder = None
_reranker = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding

        _embedder = TextEmbedding(EMBED_MODEL, threads=_ONNX_THREADS)
    return _embedder


def _get_reranker():
    global _reranker
    if _reranker is None:
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        _reranker = TextCrossEncoder(RERANK_MODEL, threads=_ONNX_THREADS)
    return _reranker


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    return [vec.tolist() for vec in _get_embedder().embed(texts)]


def embed_one(text: str) -> list[float]:
    return embed([text])[0]


def rerank(query: str, documents: list[str]) -> list[float]:
    """One score per document, same order as `documents` — NOT sorted. Call on the
    top-N candidates a vector search already narrowed down, never the whole corpus:
    a cross-encoder scores query x candidate pairs directly, it isn't an index."""
    if not documents:
        return []
    return list(_get_reranker().rerank(query, documents))
