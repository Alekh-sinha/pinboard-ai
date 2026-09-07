# Persona architecture — a trace-through guide

This is a guide for tracing how personas (coworkers) are defined, discovered, resolved
into a running session, and — for `team: lead` personas — how they staff workers. Every
claim below is backed by a specific file/function so you can jump straight to the code
and confirm it yourself.

## 1. What a persona is

A persona is a manifest: a `manifest.md` file with YAML frontmatter + a markdown body.
The body becomes the system prompt verbatim. `cowork` and `code` are the two exceptions
— they're hardcoded Python builders (`_register_builder`) rather than files, kept that
way because they're the two core surfaces the app ships with, not something a user
installs or edits.

Three "kinds" of persona, driven by one field, `team:`:

| `team:` value | Meaning | Staffable? | Surfaced in session picker? |
|---|---|---|---|
| absent (`None`) | Solo persona (`cowork`, `code`) | No | Yes |
| `lead` | Runs a team; gets staffing tools | No (leads aren't staffed) | Yes |
| `worker` | Staffed by a lead onto a board | Yes | No — never (see §4) |

## 2. Where personas live on disk

```
coworker/personas/builtin/
  ops.md                        # a loose top-level manifest file
  research-lead/manifest.md     # one-persona-per-subfolder bundle
  research-assistant/manifest.md
  appsec-worker/
    manifest.md
    skills/security-fix-pr/SKILL.md   # optional bundled skill(s), see §7
    skills/semgrep-review/SKILL.md
  ... (swe-lead, swe-worker, devops-lead, devsecops-lead, triage-lead,
       infra-worker, logs-worker, test-worker, design-worker, change-worker,
       secrets-worker, posture-worker, cloud-posture, security, dep-audit, ...)
```

Every worker/lead folder has a `manifest.md` — no exceptions. A `skills/` subfolder,
when present, is optional cargo that rides *alongside* the manifest, never a
replacement for it (§7).

Two more sources feed the same registry, same mechanism:
- `extra_dirs` passed to `PersonaRegistry(...)` (a deployment can add more manifest dirs).
- `~/.config/coworker/personas-installed/<id>/` — the snapshot area for third-party
  installs and UI-registered workers (`build_worker_bundle` → `install_from_dir`, §10).

## 3. Boot-time registration — the one-time scan

`PersonaRegistry.__init__` (`coworker/personas/registry.py`) builds one in-memory dict,
`self._entries: dict[str, PersonaEntry]`, **exactly once**, when the server process
starts (constructed once inside `CoworkerManager.__init__`, `coworker/server/manager.py`).

1. `_load_builtin()` (`registry.py:151-209`):
   - Two hardcoded `_register_builder(...)` calls: `cowork`, `code`.
   - Then `_load_dir(coworker/personas/builtin/, builtin=True)`.
2. `_load_dir()` (`registry.py:211-227`) — the actual "for every persona name" loop:
   ```python
   for md in sorted(d.glob("*.md")):                       # loose top-level files
       self._register_manifest(load_manifest_file(md, ...), ...)
   for sub in sorted(p for p in d.iterdir() if p.is_dir()): # <id>/manifest.md bundles
       md = sub / "manifest.md"
       if md.is_file():
           self._register_manifest(load_manifest_file(md, ...), ...)
   ```
3. `_register_manifest(m, ...)` (`registry.py:229-...`) is the actual insert:
   ```python
   self._entries[m.id] = PersonaEntry(id=m.id, ..., team=m.team, manifest=m, ...)
   ```
   `m.id` is the manifest's own `id:` frontmatter field — that string becomes the dict
   key every later lookup uses.
4. `_load_installed()` (`registry.py:214-219`) runs the same `_load_dir()` loop over the
   installed-personas snapshot dir, so a UI-registered worker lands in the same dict
   without a restart.

**Nothing after this point ever re-scans the filesystem to resolve a persona id.**
Picking a persona is a plain dict lookup against whatever this one scan found.

## 4. Enabled vs. visible — two separate gates, easy to conflate

- **`is_enabled(persona_id)`** (`registry.py:267-278`) — a *persisted user-choice
  override*, `self._enabled: dict[str, bool]`, loaded from/written to `personas.json`.
  If never touched, falls back to `entry.default_enabled` (`True` for a normal builtin).
- **`_visible(entry)`** (`registry.py:247-250`):
  ```python
  return e.ships or include_unshipped() or self._enabled.get(e.id) is True
  ```
  Personas shipped with `ships: false` (most leads/workers today — they're still being
  tested) are invisible unless `OPENWORKER_UNSHIPPED` is set (internal build) or the
  user has *explicitly* toggled them on at least once.

Both gates are checked together everywhere it matters — `worker_catalog()`, `list_all()`
(the Coworkers settings page), `sidebar()` (the session picker). Flipping a persona's
toggle in Settings (`set_enabled()`, `registry.py:373-382`, reached via
`POST /v1/personas/{id}` → `manager.set_persona_enabled()`) writes to `self._enabled`,
which satisfies *both* checks in one action.

`team: worker` personas additionally never surface in the session picker regardless of
enabled state — `default_surfaced=m.team != "worker"` (`registry.py:211`), because their
prompts are written at a lead, not a human.

## 5. Session start — persona id to running engine

1. **UI**: user picks a persona → the id rides the session's WebSocket connection URL
   as a query param.
2. `coworker/server/app.py:2196` — `agent = ws.query_params.get("agent") or "code"`. A
   plain string off the URL; nothing resolved yet.
3. `app.py:2557` → `manager.get_engine(session_id, agent=agent, ...)`.
4. `coworker/server/manager.py:590` — `get_engine` is **session_id-keyed and cached**
   (`self._engines: dict[session_id, TurnEngine]`). On a cache hit it returns instantly —
   the registry is never touched again for that session.
5. On a cache miss (`manager.py:608-610`):
   ```python
   record = self.session_store.load(session_id)
   agent_name = (record.agent if record else agent) or "code"   # saved record WINS
   ag = get_agent(agent_name)
   ```
   A *resumed* session ignores the query string entirely and uses whatever's persisted
   in `SessionRecord.agent` (`coworker/sessions.py:21`) — so a stale `?agent=` in a
   reconnect can't silently swap a running conversation's persona.
6. `coworker/agents/registry.py:15-21` — `get_agent(name)`: one special case for the
   legacy `"myhelper"` id, otherwise `get_registry().agent(name)`.
7. `coworker/personas/registry.py:298-306` — `PersonaRegistry.agent(persona_id)`:
   ```python
   entry = self._entries.get(persona_id)
   return entry.agent()
   ```
   `entry.agent()` (`registry.py:74-78`) calls `self._builder()` (code-registered) or
   `self.manifest.to_agent()` (manifest-backed).
8. `to_agent()` (`personas/manifest.py:106-125`) materializes the runtime `Agent`:
   `system_prompt=self.system_prompt` (the manifest body, verbatim, unwrapped),
   `team=self.team`, `connectors`, `exclude_tools`, etc.
9. `coworker/agent.py:build_engine(agent=ag, ...)` — assembles the actual instructions
   string and tool registry (§6).

## 6. The system prompt is bigger than the persona's own text

`build_engine`'s static `instructions` string (`agent.py:406-455`) stacks, in order:

```
agent.system_prompt                    # the manifest body / COWORK_INSTRUCTIONS / etc.
+ _NARRATION_GUIDANCE
+ _FIRST_CONTACT_GUIDANCE
+ environment_context(ws)              # workspace path, OS, today's date
+ AGENTS.md conventions                # if the workspace has one
+ user's own standing rules            # Settings ▸ Memory free-text
+ _MEMORY_GUIDANCE + remembered facts  # if memory is on
```

This applies **identically** regardless of persona — there is no code path that skips
any of this for a lead vs. a solo persona. The manifest body is just the first
ingredient.

On top of that, **every turn**, `context_provider()` (`agent.py:522-571`) appends
ephemeral, always-fresh content to the latest user message (not the system prompt,
because "mid-thread system messages aren't reliable across providers" — the comment at
`agent.py:509-511`):

```
current time
+ plan/discuss mode note (if applicable)
+ folders/roots list (if any)
+ skill catalog text (§7)
+ IF agent.team == "lead": worker catalog text (§8)
```

The one and only persona-type branch in this whole per-turn block is
`if agent.team == "lead"` at `agent.py:565`.

## 7. Skills — progressive disclosure, not baked into the prompt

Two-step mechanism, entirely separate from the static instructions:

1. **Catalog line, every turn** — `skill_catalog_text()` (`coworker/skills/base.py:92-104`)
   builds exactly this string:
   ```
   Available skills — call load_skill(name) to load one's full instructions when
   it's relevant to the task:
   - skillname: one-line description
   ```
   Called from `context_provider()` (`agent.py:545-549`), which `skill_loader.rescan()`s
   first — a skill installed/enabled mid-session applies from the *next message*, no new
   session needed.
2. **`load_skill(name)` tool** (`coworker/skills/base.py:110-136`) — the model calls this
   when it decides a listed skill is relevant; returns the skill's full markdown
   instructions + resources path. That result then enters the conversation as a tool
   result. The model only pays for a skill's full text when it actually picks one.

Skill *sources*, both always active regardless of persona:
- **Global library** — `state_dir()/skills` + `<workspace>/.coworker/skills`
  (`agent.py:184-188`, `_skill_dirs()`). Unconditional; every persona sees it.
- **Persona-bundled skills** — a manifest-backed persona can additionally ship its own
  `skills/` folder next to its `manifest.md` (`appsec-worker/skills/...`), narrowed by
  its manifest's `skills:` allowlist. `persona_skill_scope()`
  (`coworker/server/manager.py:5991-6008`) resolves this — **additive on top of** the
  global library, never a replacement, and private to that one persona id.

## 8. Lead vs. worker — one field, read in a handful of specific places

`team:` is parsed once (`meta.get("team")` in `manifest.py`), copied straight through
`PersonaEntry.team` → `Agent.team`, and read — nowhere inferred — at:

- `agent.py:498-499` — NOT `team == "lead"` gets `propose_plan` (the solo planning gate).
- `agent.py:503-507` — `team == "lead"` gets `propose_work_items` + `propose_team`.
- `agent.py:565-570` — `team == "lead"` gets the worker-catalog context injection (§6).
- `manager.py:2130-2170` (`_team_options_tool`) / `registry.py:325-344`
  (`worker_catalog()`) — only `team == "worker"` entries are listed as staffable.
- `manager.py:2233` (`create_team()`) — fails closed:
  `"'{pid}' is not team-capable (needs team: worker)"` if a lead tries to staff
  something that isn't `team: worker`.
- `agent.py:319-325` — `agent.team is not None` (lead OR worker) defaults the `browser`
  connector on; solo personas are excluded from this rule.

## 9. How a lead discovers workers, and how staffing actually happens

**Discovery** — two parallel paths, same underlying data:
- Passive: `worker_catalog_text()` injected every turn (§6), so a lead sees its options
  without asking.
- Active: `team_options()` tool (`manager.py:2130-2170`), registered *only* for
  `role == "lead"` sessions (`manager.py:2051-2053`). Docstring: "call before
  propose_team." Walks `manager.personas.ids()`, keeps `team == "worker"` +
  `is_enabled()`, returns `{persona, name, tagline, recommended_models}` per worker.

**Staffing** — the model never picks a worker by any code-side matching; it reads
taglines/descriptions and decides, then calls `propose_team` with a `persona` id string
it typed itself (`teams/tools.py:_PROPOSE_TEAM_SCHEMA`). From there:

1. `propose_team_tool()`'s Python body is a stub — real handling lives in the engine.
   `coworker/engine.py:1538-1568` intercepts the call, emits `Event(TEAM_PROPOSED, ...)`,
   then `await self.team_approver(dict(args), tool_call.id)`.
2. `team_approver` is injected at engine-construction time
   (`engine.py:141-144`/`agent.py:234,593`), implemented inline in the WebSocket handler:
   `coworker/server/app.py:2453-2495`. It parks a durable Inbox item (so approval works
   even if the user isn't watching live), `await manager.inbox.wait(item.id)`, and on
   approval:
   ```python
   return manager.create_team(session_id, [...], enable_chat=enable_chat)
   ```
3. `create_team()` (`manager.py:2210-2299`) validates each member
   (`get_agent(pid)` must resolve and have `team == "worker"`), then **pre-spawns** —
   writes a `SessionRecord(session_id=worker_sid, agent=pid, messages=[])` straight to
   disk. **No engine is built, zero tokens spent.**
4. The worker's engine is only built the first time it's actually delivered a turn (e.g.
   the lead assigns it a board item) — `deliver_to_session()` (`manager.py:4748-4758`)
   calls `self.get_engine(session_id)` with **no explicit `agent=` argument at all**, and
   it doesn't need one: because step 3 already wrote the record, `get_engine`'s own
   cache-miss logic (§5 step 5) reads `record.agent = pid` and resolves the correct
   worker persona through the exact same `get_agent()` path a human-picked lead went
   through. Same resolver, two different sources for the name.

## 10. Registering a new worker at runtime (no restart needed)

`build_worker_bundle()` (`coworker/personas/subagent_builder.py`) generates a
self-contained `manifest.md` (+ optional `skills/<name>.md`) from form inputs, then hands
it to `PersonaRegistry.install_from_dir()` — the exact same install path any third-party
persona goes through, landing disabled pending consent. This is a generator for the
existing install mechanism, not a new one; it's how `POST /v1/subagents/register`
(`server/app.py`) turns a filled-in form into a real, registry-resolvable persona without
a server restart, going through step 4 of §3 (`_load_installed()`'s snapshot dir).

## 11. Quick reference

| Question | Answer | File |
|---|---|---|
| Where are personas discovered? | `_load_dir()`, boot-time glob of `manifest.md` files | `personas/registry.py:211-227` |
| Where does a persona id resolve to an `Agent`? | `PersonaRegistry.agent()` → `entry.agent()` | `personas/registry.py:298-306`, `74-78` |
| Where's the manifest body turned into a system prompt? | `to_agent()` | `personas/manifest.py:106-125` |
| Where's the full instructions string assembled? | `build_engine()` | `agent.py:406-455` |
| Where's the per-turn skill/worker catalog injected? | `context_provider()` | `agent.py:522-571` |
| Where does a lead learn what workers exist? | `worker_catalog_text()` (passive), `team_options()` (active) | `agent.py:565-570`, `manager.py:2130-2170` |
| Where does staffing actually get approved? | `team_approver` | `server/app.py:2453-2495` |
| Where do worker sessions get pre-spawned? | `create_team()` | `server/manager.py:2210-2299` |
| Where does a worker's engine actually get built? | `deliver_to_session()` → `get_engine()` cache-miss path | `server/manager.py:4748-4758`, `575-...` |
| Where's the lead/worker enable toggle? | `set_enabled()` / `set_persona_enabled()` | `personas/registry.py:373-382`, `server/manager.py:955-973` |
| How does a new worker get registered without a restart? | `build_worker_bundle()` → `install_from_dir()` | `personas/subagent_builder.py` |
