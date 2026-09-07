"""browser-pool — a small pool of headless Playwright browser contexts, exposed as one
MCP tool: render_fetch. Fills the gap the built-in headed browser doesn't cover: reading
several JS-rendered pages in parallel without popping a visible window for each one (the
headed browser in coworker/connectors/browser_automation.py is a singleton, one page,
one thread — right for a human-supervised login flow, wrong for fan-out research reads).

Must run in the same Python environment as `coworker` (this repo's own package): it
imports coworker.web.guard.check_url directly rather than reimplementing the SSRF /
private-IP guard, so the two never drift. If `import coworker` fails, install this
server into coworker's own venv, or add the openworker repo root to PYTHONPATH.

`site_profile`, when given, loads a login session saved by the headed browser's
`browser_save_login` tool (coworker/browser_logins.py) before navigating — the same
JSON file, read directly off disk. This only works because both processes run on the
same machine (local-desktop deployment); no IPC is needed, just a shared file path.
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

try:
    from coworker.web.guard import check_url
except ImportError as exc:  # pragma: no cover - setup-time failure, not a runtime path
    raise RuntimeError(
        "browser-pool must run in the same environment as the `coworker` package "
        "(import coworker.web.guard failed) — install into coworker's venv, or add "
        "the openworker repo root to PYTHONPATH."
    ) from exc

from coworker.browser_logins import load as load_login

mcp = FastMCP("browser-pool")

_MAX_CONCURRENCY = int(os.environ.get("BROWSER_POOL_MAX_CONCURRENCY", "4"))
_semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
_pw_lock = asyncio.Lock()
_playwright = None
_browser = None

_SNAPSHOT_JS = """
() => ({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })
"""


async def _get_browser():
    global _playwright, _browser
    async with _pw_lock:
        if _browser is None:
            from playwright.async_api import async_playwright

            _playwright = await async_playwright().start()
            _browser = await _playwright.chromium.launch(headless=True)
        return _browser


def _redirect_refusal(requested: str, final: str) -> Optional[str]:
    """Same OPE-124 concern as the headed browser's redirect_refusal: `check_url` vets
    the URL the model supplied, but the browser follows redirects to an address the
    guard never saw. Checked again here after navigation lands."""
    if not final or final == requested:
        return None
    return check_url(final)


@mcp.tool(
    description=(
        "Render a URL with a real (headless) browser and return its visible text — "
        "use this instead of a plain HTTP fetch when the page needs JavaScript to "
        "show its content (most modern news sites, JS-rendered paywalled pages). "
        "Pass `site_profile` (a site name previously saved via the headed browser's "
        "browser_save_login tool) to render as a logged-in user on that site. Safe "
        "to call many of these concurrently — each call gets its own isolated "
        "browser context, not a shared page."
    )
)
async def render_fetch(
    url: str, max_chars: int = 20000, site_profile: Optional[str] = None
) -> dict[str, Any]:
    if not url.lower().startswith(("http://", "https://")):
        return {"error": "url must start with http:// or https://"}
    blocked = check_url(url)
    if blocked:
        return {"error": blocked}

    storage_state = None
    if site_profile:
        storage_state = load_login(site_profile)
        if storage_state is None:
            return {"error": f"no saved login for site_profile={site_profile!r}"}

    async with _semaphore:
        browser = await _get_browser()
        context = await browser.new_context(
            storage_state=storage_state, viewport={"width": 1280, "height": 900}
        )
        try:
            page = await context.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                landed = _redirect_refusal(url, page.url)
                if landed:
                    final = page.url
                    # Leave nothing readable behind — mirrors the headed browser's
                    # own redirect handling.
                    await page.goto("about:blank")
                    return {"error": f"redirected to {final} — {landed}"}
                data = await page.evaluate(_SNAPSHOT_JS)
            finally:
                await page.close()
        except Exception as exc:
            return {"error": str(exc)}
        finally:
            await context.close()

    text = re.sub(r"\n{3,}", "\n\n", str(data.get("text") or ""))
    cap = max(1, min(int(max_chars or 20000), 100000))
    return {
        "title": data.get("title"),
        "url": data.get("url"),
        "text": text[:cap],
        "truncated": len(text) > cap,
    }


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
