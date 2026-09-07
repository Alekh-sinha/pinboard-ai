# search-pro

Tavily + Brave web search as two separate MCP tools (`tavily_search`, `brave_search`),
each exposing its provider's real parameters instead of coworker's generic
`{query, max_results}` `web_search` wrapper.

## Setup

```bash
cd mcp-servers/search-pro
pip install -e .
```

Get API keys: [Tavily](https://tavily.com) and [Brave Search API](https://brave.com/search/api/)
both have free tiers.

## Where the API keys come from

Each tool checks two places, in order:

1. **Settings ▸ Web search** — coworker's existing `web_search:default` secret profile
   (the one the built-in `web_search` tool itself uses), *if* that setting is currently
   pointed at this provider ("tavily" or "brave"). No extra setup — if you've already
   configured Tavily or Brave there, `tavily_search`/`brave_search` picks it up
   automatically. Since that setting holds exactly one provider at a time, this only
   ever supplies one of the two tools' keys.
2. **`TAVILY_API_KEY` / `BRAVE_API_KEY`** in this server's own process environment —
   the way to have both tools keyed simultaneously, or to key this server independently
   of Settings.

Reading (1) requires this process to see the same `secrets.json` coworker's main
process uses — if coworker runs with a non-default `COWORKER_STATE_DIR`, pass it
through below.

## Register with coworker

Add to `.coworker/mcp.json` (workspace, requires trusting the workspace) or
`~/.config/coworker/mcp.json` (global):

```json
{
  "mcpServers": {
    "search-pro": {
      "command": "search-pro",
      "env": {
        "TAVILY_API_KEY": "${TAVILY_API_KEY}",
        "BRAVE_API_KEY": "${BRAVE_API_KEY}",
        "COWORKER_STATE_DIR": "${COWORKER_STATE_DIR}"
      }
    }
  }
}
```

`${VAR}` refs are resolved by coworker's SecretStore (env / `~/.config/coworker/.env`)
before the server starts — put the real keys there, never in this file. Both env
entries are optional if you're relying on Settings ▸ Web search for the key instead
(see above) and coworker runs with its default state dir.

If you didn't install the console script, use instead:

```json
"command": "python", "args": ["-m", "search_pro"]
```

## Avoiding a redundant search tool

A persona that uses this server should suppress the built-in `web_search` tool via the
manifest field `exclude_tools: [web_search]`, so the model only sees `tavily_search` /
`brave_search`, not a third generic option.
