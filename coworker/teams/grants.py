"""Per-team connector/MCP grants — Team Setup lets a user grant extra connectors/MCP
servers to a team's lead, its workers, or both, ON TOP OF whatever each persona's own
manifest already declares. Additive only, same posture as the existing connector
allowlist (personas/manifest.py's `_connectors`): this never lets a persona see LESS
than its own manifest declares, and never bypasses the user's own connector
enable/auth gates — it only ever widens what a persona already has, scoped to one team.

Why this needs to exist separately from the manifest: a persona is authored once and
reused; a team is assembled per-task. Without this, giving one lead persona GitHub
access for a coding project and browser access for a research project would mean two
different lead manifests, or editing the manifest file per project. This layer lets one
persona serve both, with the extra grant living with the TEAM, not the persona.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from ..secrets import state_dir

VALID_SCOPES = ("lead", "worker", "both")


@dataclass
class TeamGrant:
    connectors: list[str] = field(default_factory=list)
    mcp: list[str] = field(default_factory=list)
    scope: str = "both"  # "lead" | "worker" | "both"


class TeamGrantStore:
    """File-backed, keyed by team_id — same state_dir()-rooted, JSON-file pattern as
    browser_logins.py/secrets.py."""

    def __init__(self, path: Optional[str | Path] = None) -> None:
        self.path = Path(path) if path else state_dir() / "team_grants.json"
        self._lock = threading.Lock()

    def _read(self) -> dict:
        if not self.path.is_file():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def get(self, team_id: str) -> list[TeamGrant]:
        raw = self._read().get(team_id, [])
        return [TeamGrant(**g) for g in raw if isinstance(g, dict)]

    def set(self, team_id: str, grants: list[TeamGrant]) -> None:
        with self._lock:
            data = self._read()
            data[team_id] = [asdict(g) for g in grants]
            self._write(data)

    def add(self, team_id: str, grant: TeamGrant) -> None:
        if grant.scope not in VALID_SCOPES:
            raise ValueError(f"scope must be one of {VALID_SCOPES}")
        with self._lock:
            data = self._read()
            data.setdefault(team_id, []).append(asdict(grant))
            self._write(data)

    def clear(self, team_id: str) -> None:
        with self._lock:
            data = self._read()
            data.pop(team_id, None)
            self._write(data)

    def connectors_for(self, team_id: str, role: str) -> set[str]:
        """role: 'lead' or 'worker'. Never raises for an unknown team_id — an
        unstaffed/setup-time team just has no grants yet."""
        return {c for g in self.get(team_id) if g.scope in (role, "both") for c in g.connectors}

    def mcp_for(self, team_id: str, role: str) -> set[str]:
        return {m for g in self.get(team_id) if g.scope in (role, "both") for m in g.mcp}
