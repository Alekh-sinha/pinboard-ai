# Adding a persona

A persona (what the UI calls a "coworker") is what turns a generic agent into a
specialist — a lead that runs a team, a worker staffed onto a board, or a standalone
assistant with its own tools and system prompt. There are two ways to add one, depending
on how much control you need.

## Demo: a persona in use[

<video src="https://github.com/Alekh-sinha/pinboard-ai/assets/adding-a-persona-demo.mp4" controls width="640" height="360">
</video>

*(If your viewer doesn't render the tag above, [open the video directly](assets/adding-a-persona-demo.mp4).)*

## Option 1 — Register a worker from the UI (no code, no restart)

The fastest path, for a custom worker with its own system prompt:

1. Open the **Team** page (`+` → Persona → Team), or **Manage Coworkers** from Settings.
2. In the Worker box, open **Register a worker** and fill in the form — name, tagline,
   the system prompt, and which tools it needs.
3. Submitting calls `POST /v1/subagents/register`, which generates a real manifest on
   disk (`build_worker_bundle()`) and installs it through the same mechanism any
   third-party persona goes through (`PersonaRegistry.install_from_dir()`).
4. It lands **disabled, pending consent** — enable it in Settings ▸ Coworkers before a
   lead can staff it.

No server restart needed — this path writes into the installed-personas snapshot
directory, which the registry re-scans without a restart.

## Option 2 — A manifest file (full control, ships with the app)

This is how every built-in persona in this repo is defined, including the
research/document team built this session (`research-lead`, `research-assistant`,
`doc-worker`) — worth reading as real, working examples.

### Where it lives

```
coworker/personas/builtin/
  ops.md                       # a simple persona can be one loose top-level file
  <your-persona-id>/
    manifest.md                # required
    skills/
      some-skill/
        SKILL.md                # optional bundled skill(s) — see the gotcha below
```

The folder name doesn't have to match the `id:` field, but keeping them identical is
the convention every existing persona follows.

### The manifest itself

`manifest.md` is YAML frontmatter + a markdown body. **The body becomes the system
prompt verbatim** — nothing is added or rewritten around it besides the app's own
standard scaffolding (current time, workspace path, memory, etc.).

```markdown
---
ships: true
id: your-persona-id
name: Display Name
icon: file
tagline: One line shown in the picker
requires_folder: true
subagents: true
version: "1"
team: worker          # omit for solo, "lead" for a team lead, "worker" for a staffable worker
tools: [files, todo]
connectors: [browser]  # or omit/false
mcp: [rag]              # raw MCP server ids this persona's sessions get, unscoped by user config
exclude_tools: [web_search]
default_permission_mode: interactive
description: Longer description shown in the settings list and picker.
---
Your system prompt goes here, in full — this is everything the model sees as its
identity and instructions. Write it the way you'd brief a new hire: what you own, what
tools to reach for and when, and the rules you won't bend on.
```

| Field | What it controls |
|---|---|
| `ships` | `true` (default) = visible to everyone; `false` = hidden unless `OPENWORKER_UNSHIPPED=1` or the user explicitly enables it — useful for testing before a wide release. |
| `team` | Absent = solo persona (shows in the session picker, can't be staffed). `lead` = runs a team, gets `propose_work_items`/`propose_team`. `worker` = staffable by a lead, **never** shows in the session picker itself. |
| `tools` / `connectors` / `mcp` / `exclude_tools` | What this persona's sessions actually get. |
| `recommended_models` | Just a hint shown to a human (or a lead reading `team_options()`) — **not validated against what's actually configured**. See the gotcha below. |
| `requires_folder` | Whether starting a session with this persona requires picking a workspace folder first. |
| `group` | Which section it's grouped under in the Coworkers settings list (defaults to `"general"`). |

A full field reference lives in `coworker/personas/manifest.py`'s `PersonaManifest`
dataclass — the frontmatter keys map 1:1 to its fields.

### Applying it

Manifests are only scanned **once, at server boot** — editing or adding one requires
restarting the backend before it's picked up. (Skills and tool-registry changes to an
*already-loaded* persona, by contrast, do hot-reload — see the gotcha below.)

## Two real gotchas, hit while building this session's research team

**A persona only ever sees its own bundled `skills/` folder — never another persona's,
even a closely related one.** If a lead's prompt says "call `load_skill('x')`", that
skill must physically exist under *that persona's own* `skills/` directory, or the call
fails outright. There's no sharing mechanism today; if three personas all need the same
skill, that skill's folder gets copied into all three. (This is exactly the bug that
shipped a broken `.docx` earlier this session — the lead's prompt told it to use a
skill it had never actually been given.)

**`recommended_models` is a hint, not a guarantee.** A lead reading a worker's
`recommended_models` and naming that exact model in a `propose_team` call can pick a
provider that isn't configured in the user's actual environment, failing that worker's
very first turn. If a persona needs to hand a specific model to a worker it staffs, it
should read `available_models` from the `team_options()` tool result instead — that's
the user's own real, configured model pool, not a generic manifest field.

## Further reading

`docs/persona-architecture.md` is a much deeper, code-cited trace-through of how a
persona id resolves into a running engine, how staffing actually works end to end, and
where every one of these mechanisms lives in the source — read that if you're debugging
something rather than adding something new.
