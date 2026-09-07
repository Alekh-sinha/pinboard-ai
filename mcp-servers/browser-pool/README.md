# browser-pool

A small pool of headless Playwright browser contexts, exposed as one MCP tool
(`render_fetch`). Complements the built-in headed browser (see
`coworker/connectors/browser_automation.py`), which stays single-instance/interactive
for human-supervised logins — this server is for fanning out reads of many JS-rendered
pages in parallel, headlessly.

## Setup

**Must run in the same Python environment as `coworker`** — it imports
`coworker.web.guard.check_url` directly so the SSRF/private-IP guard never drifts
between the two, and `coworker.browser_logins` to read saved logins. From the openworker
repo's own venv:

```bash
cd mcp-servers/browser-pool
pip install -e .
python -m playwright install chromium
```

## Register with coworker

Add to `.coworker/mcp.json` or `~/.config/coworker/mcp.json`:

```json
{
  "mcpServers": {
    "browser-pool": {
      "command": "browser-pool"
    }
  }
}
```

Optional: `BROWSER_POOL_MAX_CONCURRENCY` (env, default 4) caps how many pages render at
once.

## Using a saved login

1. In a coworker session, open the headed browser, log into a site by hand, then have
   the agent call `browser_save_login(site="wsj")` (only after you've said yes — it
   asks first).
2. Call `render_fetch(url, site_profile="wsj")` here (or on a fresh headless session
   later) to read that site as the logged-in user, without opening a visible window.

## Note on tool overlap

`browser-pool` is a separate concern from `search-pro`: search finds URLs, `render_fetch`
reads one. Neither replaces coworker's built-in `web_fetch` (plain HTTP, cheaper, no JS)
— use `web_fetch` first and fall back to `render_fetch` only when a page needs
JavaScript to show its content.
