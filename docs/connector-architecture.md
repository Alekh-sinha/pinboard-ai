# Connector architecture — a trace-through guide

Traces the **pre-existing** connector mechanism only — how a manifest declares connector
access, how a user can adjust it per persona/session through the UI, and how that
resolves into the actual tools a running session gets. This does **not** cover the
per-team grant store, `coworker/teams/grants.py` (`TeamGrantStore`) — a separately
tracked addition layered on top of this mechanism, which doesn't correctly compose with
it (see §7). This doc is the baseline to understand before touching that.

A second addition, a global per-role default store (`teams/role_defaults.py`), was built
on the same session, found to have the identical composition bug, and was **removed**
rather than fixed — the design that replaced it (`general-lead`/`general-worker` as
`ships: true` manifests, connector access set per-persona via the existing §5 mechanism
against those two fixed ids) needed no new store at all. Mentioned here only so a reader
who saw an earlier version of this doc isn't left looking for code that no longer
exists.

**Headline finding, stated up front**: this pre-existing system has **no concept of
lead vs. worker role for connectors**. Every persona — solo, lead, or worker — is
gated the exact same way, per its own persona id. There is no "give every lead X" or
"give every worker Y" primitive anywhere in this mechanism; access is authored once per
persona (in its manifest) and optionally adjusted once per persona (via the UI), full
stop.

## 1. The manifest declares a ceiling, not a preference

Two related-but-different frontmatter fields, parsed in `coworker/personas/manifest.py`:

- **`connectors:`** — the hard grant. Parsed by `_connectors()` (`manifest.py:128-178`):
  ```python
  if raw is None or raw is False:
      declared = False                              # no connectors at all
  elif raw is True:
      # LEGACY shim: becomes exactly the persona's `recommends` connector refs
      refs = {r.ref for r in recommends if r.kind == "connector"}
      declared = tuple(sorted(refs)) if refs else False
  elif raw == "all":                                # the STRING "all", not boolean true
      if not builtin:
          raise ManifestError(...)                  # reserved for built-in personas only
      declared = True                                # truly unrestricted
  elif isinstance(raw, list):
      declared = tuple(...)                          # explicit allowlist — the normal case
  ```
  **Subtlety worth remembering**: writing `connectors: true` (YAML boolean) does **not**
  mean unrestricted. `coworker/personas/builtin/ops.md` has `connectors: true` and 4
  `recommends:` entries (`github`, `slack`, `datadog`, `pagerduty`) — its actual grant
  is the tuple `(datadog, github, pagerduty, slack)`, nothing more. The *only* way a
  manifest gets `True` (genuinely unrestricted — every connected connector, no ceiling)
  is the literal string `"all"`, and that's rejected outright for non-builtin manifests.
  Compare `research-lead`/`research-assistant`: `connectors: [browser]` — an explicit
  one-item allowlist, the normal case.
  A validation rule enforces consistency: a `recommends:` connector entry must already
  be inside the `connectors:` grant, or the manifest fails to load (`manifest.py:170-177`,
  `"a recommendation must stay within the grant"`).

- **`recommends:`** — a list of `{connector: <id>, reason: <text>, tier: core|optional}`
  (`Recommendation` dataclass, `manifest.py:36-46`). This does **not** grant access on
  its own — it only seeds what's *on by default* within whatever `connectors:` already
  grants (§2). A `tier: core` recommendation seeds default-**on**; `tier: optional`
  seeds default-**off** but still toggleable.

Real example, `coworker/personas/builtin/cloud-posture/manifest.md`:
```yaml
connectors: [github]
recommends:
  - connector: github
    reason: open fix PRs for the Terraform changes
    tier: optional
```
Grant = `{github}`. Default-on = nothing (optional tier) — the user has to flip it on
themselves, but `github` is the *only* connector this persona's sessions can ever use,
no matter what.

## 2. Three layers resolve what's actually usable — `coworker/connections.py`

```
1. account-connected   — does the connector have valid creds at all? (SecretStore)
2. persona-default-on  — per persona, on/off for each connector (PersonaConnectionStore)
                          seeded from `recommends` (core→True, optional→False), then
                          user-editable
3. session-override     — per session, explicit on/off beating the persona default
                          (SessionConnectionStore); absent = inherit persona default
```

`effective()` (`connections.py:158-181`) resolves these three layers:
```python
for connector in connected:
    enabled = session_override if present
              else persona_default if present
              else True   # connected, persona has no opinion → inherit ON
```

**Important asymmetry**: a connected connector the persona's `recommends:` never
mentions at all still defaults to **on** at this layer — `recommends` curates what to
*suggest*, it is explicitly not an exhaustive allowlist (`connections.py:14-17`
docstring). The actual allowlist ceiling is `connectors:` from §1, applied afterward
(§3) — `effective()` on its own only decides defaults/mutes among whatever's already
connected, it doesn't know about the manifest's hard grant at all.

`PersonaConnectionStore.defaults_for()` (`connections.py:63-94`) does the one-time seed
from `recommends` on first read, then persists — a later toggle survives future reads.

## 3. Where the ceiling actually gets applied — `manager.py`

`_persona_connector_grant()` (`server/manager.py:813-826`):
```python
def _persona_connector_grant(self, persona_id) -> Optional[set[str]]:
    entry = self.personas.get(persona_id)
    if entry is None or entry.manifest is None:
        return None                       # code-registered builtins: no restriction
    declared = entry.manifest.connectors
    if declared is True:
        return None                       # "all" manifests: no restriction
    return set(declared or ())            # the hard allowlist from §1
```

`effective_connectors()` (`manager.py:828-852`) combines everything:
```python
effective = effective(connected, persona_defaults, session_overrides)   # §2
grant = self._persona_connector_grant(persona)                          # §1's ceiling
return effective if grant is None else effective & grant                # intersect
```

So the real rule, end to end: **a connector is usable by a session only if it's
connected, not muted by persona-default/session-override, AND inside the persona's
manifest-declared `connectors:` grant.** `recommends`/toggles can never grant something
outside the manifest's own ceiling — they only curate defaults *within* it.

## 4. Where this reaches the actual running engine — `agent.py`

`effective_connectors()`'s result is passed into `build_engine()` as `connector_filter`
(`manager.py:716`, `4558`). Inside `build_engine` (`agent.py`):
```python
connectors_decl = agent.connectors                       # from Agent, ultimately §1's `declared`
if connectors_decl is not True:
    enabled_connectors = enabled_connectors & set(connectors_decl)   # manifest ceiling
if connector_filter is not None:
    enabled_connectors = enabled_connectors & connector_filter        # §2/§3's resolved set
registry.register_all(make_integration_tools(secrets, enabled_connectors=enabled_connectors, ...))
```
Two intersections, same ceiling expressed twice (once from the `Agent` object directly,
once via the manager-computed `connector_filter`) — both must agree for a connector's
tools to actually register. In the unmodified system they always do, because both derive
from the same `entry.manifest.connectors`.

## 5. Updating a persona's connectors through the UI (no manifest edit)

`POST /v1/personas/{persona_id}/connections` (`server/app.py:660-669`) →
`manager.set_persona_connection(persona_id, connector, enabled)` (`manager.py:934-953`)
→ `PersonaConnectionStore.set()` (`connections.py:97-100`). This is layer 2 from §2 — a
persisted, per-persona default override. **It can only toggle a connector that's
already within the persona's `connectors:` grant** (§1/§3) — toggling one outside that
grant persists the row but has no effect, because `effective_connectors()`'s final
`& grant` intersection discards it regardless of what layer 2/3 say.

This is the mechanism behind `PersonaView`'s connections drawer in the GUI
(`surfaces/gui/src/components/PersonaView.tsx` and its test,
`PersonaView.test.tsx` — "toggling a default connection POSTs /connections and applies
the returned defaults").

## 6. What this means for lead vs. worker, concretely

Nothing in §1-§5 branches on `team:`. A lead persona and a worker persona go through the
identical resolution: manifest `connectors:` ceiling → `recommends`-seeded defaults →
UI-togglable per-persona-default → per-session override → intersect. There's no shared,
role-scoped primitive in this system — "every lead" or "every worker" isn't a concept it
has. For `general-lead`/`general-worker` specifically this doesn't matter in practice:
there are exactly two fixed, always-known ids, so "connector access for the lead" and
"connector access for the worker" are just this exact per-persona mechanism applied
twice, against two specific ids — no role abstraction needed. A genuinely dynamic "every
future lead persona gets X automatically" need would still require hand-editing each
manifest individually, or a real role-scoped store (which a first attempt at, this
session, didn't work — see the note at the top of this doc).

## 7. Known conflict with newer code (context, not part of the traced mechanism)

One addition from this session still tries to widen a persona's effective connectors
programmatically — the per-team grant store (`coworker/teams/grants.py`,
`TeamGrantStore`). It widens a local, in-memory copy of the `Agent.connectors` value
before `build_engine()` runs, but `_persona_connector_grant()` (§3) re-reads
`entry.manifest.connectors` fresh from the registry, oblivious to that widening, and
`effective_connectors()`'s final `& grant` silently strips it back out. Net effect: the
per-team grant store currently has no observable effect on a real running session.
Flagged here so anyone reading this doc doesn't assume it works — it doesn't yet, and
fixing it means either folding the widening into `_persona_connector_grant()` itself, or
reconsidering whether a per-team grant belongs in this per-persona-id system at all. It
was never wired to any UI, so nothing currently depends on it working.

A second addition with the identical bug — a global per-role default store
(`teams/role_defaults.py`) — was removed entirely rather than fixed, once
`general-lead`/`general-worker` were redesigned as plain `ships: true` manifests whose
connector access is set per-persona through the existing §5 mechanism against those two
fixed ids. No role-scoped store was needed after all.

## 8. Quick reference

| Question | Answer | File |
|---|---|---|
| Where's a persona's connector grant declared? | `connectors:` frontmatter | manifest source, e.g. `personas/builtin/cloud-posture/manifest.md` |
| Where's `connectors:` parsed into a grant? | `_connectors()` | `personas/manifest.py:128-178` |
| Where are default on/off + suggestions declared? | `recommends:` frontmatter | same manifest files |
| Where's the per-persona default/session-override hierarchy? | `effective()`, `PersonaConnectionStore`, `SessionConnectionStore` | `coworker/connections.py` |
| Where's the manifest ceiling actually enforced? | `_persona_connector_grant()` / `effective_connectors()` | `server/manager.py:813-852` |
| Where does the resolved set reach the engine? | `connector_filter` param, intersected against `agent.connectors` | `server/manager.py:716`, `agent.py` (`connectors_decl`/`connector_filter` block) |
| Where does a user edit a persona's connector defaults? | `POST /v1/personas/{id}/connections` → `set_persona_connection()` | `server/app.py:660-669`, `server/manager.py:934-953` |
| Where's the GUI control for this? | Persona detail page's connections drawer | `surfaces/gui/src/components/PersonaView.tsx` |
| Is there a lead/worker role concept here? | No — everything is per-persona-id only | n/a |
