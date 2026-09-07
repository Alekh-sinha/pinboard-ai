"""Builds a `team: worker` persona bundle (manifest.md + optional skills/) from
wizard-style inputs, then hands it to the install path that already exists and is
already fully built: `PersonaRegistry.install_from_dir` (this module, `install_from_dir`)
snapshots it into the managed area and lands it disabled pending consent, same as any
other third-party persona install. This is a generator for what that mechanism already
accepts — not a new install mechanism.
"""

from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Optional

import yaml

from .manifest import ManifestError

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", name.strip().lower()).strip("-_")[:64]


def build_worker_bundle(
    *,
    name: str,
    tagline: str,
    description: str,
    system_prompt: str,
    persona_id: Optional[str] = None,
    connectors: Optional[list[str]] = None,
    mcp: Optional[list[str]] = None,
    scheduling: bool = False,
    skill_name: Optional[str] = None,
    skill_content: Optional[str] = None,
    requires_folder: bool = True,
    tools: Optional[list[str]] = None,
) -> Path:
    """Writes a self-contained bundle directory (manifest.md + optional skills/<name>.md)
    to a fresh temp dir, ready for `PersonaRegistry.install_from_dir(bundle_dir)`.

    `scheduling=True` gives the registered worker a standing, lead-independent wake
    (the same self-wake mechanism `triage-lead` already uses — see `coworker/selfwake.py`)
    — it is a plain per-session trait, not something restricted to leads/solo personas.

    Caller owns cleanup of the returned directory after install (install snapshots into
    the registry's own managed area, so this temp dir is disposable once that succeeds).
    """
    pid = (persona_id or slugify(name)).strip().lower()
    if not _ID_RE.match(pid):
        raise ManifestError(
            f"{pid!r} isn't a usable persona id — lowercase letters/digits/._- only, max 64"
        )
    if not name.strip():
        raise ManifestError("a worker needs a name")
    if not system_prompt.strip():
        raise ManifestError("a worker needs a system prompt / working instructions")

    frontmatter: dict = {
        "id": pid,
        "name": name.strip(),
        "tagline": tagline.strip(),
        "description": description.strip(),
        "team": "worker",
        "requires_folder": requires_folder,
        "scheduling": scheduling,
        "tools": tools or ["files", "todo"],
    }
    if connectors:
        frontmatter["connectors"] = list(connectors)
    if mcp:
        frontmatter["mcp"] = list(mcp)
    if skill_name:
        frontmatter["skills"] = [skill_name]

    bundle_dir = Path(tempfile.mkdtemp(prefix="subagent-"))
    manifest_text = (
        "---\n"
        + yaml.safe_dump(frontmatter, sort_keys=False)
        + "---\n"
        + system_prompt.strip()
        + "\n"
    )
    (bundle_dir / "manifest.md").write_text(manifest_text, encoding="utf-8")

    if skill_name and skill_content:
        skills_dir = bundle_dir / "skills"
        skills_dir.mkdir()
        (skills_dir / f"{skill_name}.md").write_text(skill_content, encoding="utf-8")

    return bundle_dir


def discard_bundle(bundle_dir: Path) -> None:
    shutil.rmtree(bundle_dir, ignore_errors=True)
