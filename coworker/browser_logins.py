"""Persisted browser login sessions — opt-in "stay logged in" for the headed browser.

Stores Playwright `storage_state` blobs (cookies + localStorage), one per site, so a
paid/login-walled source logged into once via the headed browser can be read again later
without a fresh login — headed (this module) or headless (the render-pool MCP server,
which reads the same file). This is session/token state, never a raw password: nothing
here is typed by the model, read by the model, or derived from a password field's value —
it is a mechanical snapshot of whatever the browser context already holds after a human
logs in by hand.

v1 is one JSON file per site under state_dir()/browser_logins/, written with the same
user-only file protection as SecretStore (`write_private_text`).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from .secrets import state_dir, write_private_text

_SITE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def _dir() -> Path:
    return state_dir() / "browser_logins"


def normalize_site(site: str) -> Optional[str]:
    """A filesystem- and user-facing-safe site key, or None if `site` doesn't qualify."""
    s = (site or "").strip().lower()
    return s if _SITE_RE.match(s) else None


def path_for(site: str) -> Path:
    return _dir() / f"{site}.json"


def save(site: str, storage_state: dict[str, Any]) -> Path:
    """Persist a Playwright storage_state blob for `site`. Overwrites any prior save."""
    target = path_for(site)
    write_private_text(target, json.dumps(storage_state))
    return target


def load(site: str) -> Optional[dict[str, Any]]:
    """The saved storage_state for `site`, or None if nothing is saved."""
    p = path_for(site)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def forget(site: str) -> bool:
    """Delete the saved login for `site`. Returns False if nothing was saved."""
    p = path_for(site)
    if not p.is_file():
        return False
    p.unlink()
    return True


def list_sites() -> list[str]:
    """Sites with a saved login, for a settings/revoke UI."""
    d = _dir()
    if not d.is_dir():
        return []
    return sorted(p.stem for p in d.glob("*.json"))
