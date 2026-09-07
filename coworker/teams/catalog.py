"""Worker-catalog context for a lead — mirrors `skill_catalog_text`'s shape
(coworker/skills/base.py) so a lead can discover team-capable worker personas and stage
them via `propose_team` without them being hardcoded into its own system prompt.
Without this, staffing still works, but only for workers the lead already happens to
know by id — a persona the user just registered would otherwise be invisible to it.
"""

from __future__ import annotations

from typing import Any


def worker_catalog_text(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return ""
    lines = [
        f"- {e['id']}: {e.get('tagline') or e.get('description') or '(no description)'}"
        for e in entries
    ]
    return (
        "Available worker coworkers you can staff via propose_team (persona id — what "
        "they're for):\n" + "\n".join(lines)
    )


def model_catalog_text(models: list[str]) -> str:
    """Same rationale as worker_catalog_text, for models: without this a lead's
    propose_team model/models choice for a staffed worker has no live signal about
    what's actually configured in this installation — only a manifest's static,
    unvalidated recommended_models (or nothing)."""
    if not models:
        return ""
    return (
        "Models currently configured and usable in this installation (pick from these "
        "when proposing a model for a staffed worker via propose_team; if you don't "
        "specify one, the worker inherits your own current model):\n"
        + "\n".join(f"- {m}" for m in models)
    )
