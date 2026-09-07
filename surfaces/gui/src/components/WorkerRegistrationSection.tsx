import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getConnectors,
  getMcpServers,
  registerSubagent,
  updatePersona,
  type Connector,
  type McpServer,
  type Persona,
  type PersonaConsent,
} from "../api";
import { Icon } from "./Icon";
import { Toggle } from "./Toggle";

// Team Setup plan (U4): register a new worker/subagent — its own skill, connectors, MCP,
// and optional standing schedule — plus the worker catalog a lead actually sees
// (worker_catalog_text, coworker/teams/catalog.py). Lives on the Coworkers settings page
// (a worker is still a coworker, just staffed by a lead rather than started solo) —
// dissolved from the standalone "Team Setup" tab this session originally shipped it on.
// The default worker-model-pool editor that used to sit above this form is GONE from here
// entirely: it moved to the right-side model control (B4), decoupled from registration.
const CARD = "rounded-xl2 border border-line bg-panel";
const SEC_H = "text-[11px] uppercase tracking-[0.05em] text-faint font-semibold";
const INPUT =
  "w-full px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const TEXTAREA = INPUT + " resize-y min-h-[72px] font-mono text-[12px]";
const BTN_ACCENT = "text-[13px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const CHIP_BASE =
  "text-[12px] px-2.5 py-1 rounded-full border cursor-pointer select-none transition-colors";

function MultiChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={
        CHIP_BASE + (active ? " border-accent bg-accent/10 text-accent" : " border-line text-muted hover:border-lineStrong")
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function WorkerRegistrationSection({
  personas,
  onPersonasChanged,
  onRegistered,
}: {
  personas: Persona[];
  onPersonasChanged: () => void;
  // Applied directly from the register response (r.personas) rather than a fresh
  // getPersonasIndex() round trip — the mutation response already carries the
  // updated list, same as installPersona's own consent flow.
  onRegistered: (personas: Persona[]) => void;
}) {
  const { t } = useTranslation();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selConnectors, setSelConnectors] = useState<string[]>([]);
  const [selMcp, setSelMcp] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [consent, setConsent] = useState<PersonaConsent[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getConnectors().then(setConnectors).catch(() => {});
    getMcpServers().then(setMcpServers).catch(() => {});
  }, []);

  const workers = personas.filter((p) => p.team === "worker");

  const toggleConnector = (n: string) =>
    setSelConnectors((cur) => (cur.includes(n) ? cur.filter((c) => c !== n) : [...cur, n]));
  const toggleMcp = (n: string) =>
    setSelMcp((cur) => (cur.includes(n) ? cur.filter((c) => c !== n) : [...cur, n]));

  const canRegister = name.trim() && description.trim() && systemPrompt.trim() && !busy;

  const register = async () => {
    setBusy(true);
    setMsg(null);
    setConsent(null);
    const r = await registerSubagent({
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      system_prompt: systemPrompt.trim(),
      connectors: selConnectors,
      mcp: selMcp,
      scheduling,
      skill_name: skillName.trim() || undefined,
      skill_content: skillContent.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setMsg(r.error || t("team_setup.register_failed"));
      return;
    }
    setConsent(r.consent || []);
    if (r.personas) onRegistered(r.personas);
    setMsg(t("team_setup.registered"));
    setName("");
    setTagline("");
    setDescription("");
    setSystemPrompt("");
    setSelConnectors([]);
    setSelMcp([]);
    setScheduling(false);
    setSkillName("");
    setSkillContent("");
  };

  return (
    <div className="mt-6 space-y-5">
      <div>
        <div className={SEC_H + " mb-1.5"}>{t("team_setup.catalog_title")}</div>
        {workers.length === 0 ? (
          <p className="text-[12px] text-faint">{t("team_setup.catalog_empty")}</p>
        ) : (
          <div className={CARD + " divide-y divide-line"}>
            {workers.map((w) => (
              <div key={w.id} className="px-[18px] py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{w.name}</div>
                  <div className="text-[12px] text-faint truncate mt-0.5">{w.tagline}</div>
                </div>
                <Toggle
                  checked={w.enabled}
                  onChange={(next) => updatePersona(w.id, { enabled: next }).then(onPersonasChanged)}
                  title={w.enabled ? t("personas.disable_coworker") : t("personas.enable_coworker")}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        className="w-full flex items-center gap-2 px-4 pt-2 text-[13px] text-muted select-none"
        data-testid="register-worker-disclosure"
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon name="chevronRight" size={12} className={"transition-transform" + (expanded ? " rotate-90" : "")} />
        <span>{t("team_setup.register_title")}</span>
      </button>
      {expanded && (
        <div>
          <p className="text-[12px] text-muted mb-2.5 leading-relaxed max-w-[560px]">
            {t("team_setup.register_desc")}
          </p>
          <div className={CARD + " p-4 space-y-3"}>
            <input className={INPUT} placeholder={t("team_setup.field_name")} value={name} onChange={(e) => setName(e.target.value)} />
            <input className={INPUT} placeholder={t("team_setup.field_tagline")} value={tagline} onChange={(e) => setTagline(e.target.value)} />
            <textarea className={TEXTAREA} placeholder={t("team_setup.field_description")} value={description} onChange={(e) => setDescription(e.target.value)} />
            <textarea className={TEXTAREA} placeholder={t("team_setup.field_system_prompt")} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />

            <div>
              <div className="text-[12px] text-muted mb-1.5">{t("team_setup.field_connectors")}</div>
              <div className="flex flex-wrap gap-1.5">
                {connectors.map((c) => (
                  <MultiChip key={c.name} label={c.title} active={selConnectors.includes(c.name)} onClick={() => toggleConnector(c.name)} />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[12px] text-muted mb-1.5">{t("team_setup.field_mcp")}</div>
              {mcpServers.length === 0 ? (
                <span className="text-[12px] text-faint">{t("team_setup.mcp_empty")}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {mcpServers.map((m) => (
                    <MultiChip key={m.name} label={m.name} active={selMcp.includes(m.name)} onClick={() => toggleMcp(m.name)} />
                  ))}
                </div>
              )}
            </div>

            <input className={INPUT} placeholder={t("team_setup.field_skill_name")} value={skillName} onChange={(e) => setSkillName(e.target.value)} />
            {skillName.trim() && (
              <textarea className={TEXTAREA} placeholder={t("team_setup.field_skill_content")} value={skillContent} onChange={(e) => setSkillContent(e.target.value)} />
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <Toggle checked={scheduling} onChange={setScheduling} />
              <div>
                <div className="text-[13px]">{t("team_setup.field_scheduling")}</div>
                <div className="text-[12px] text-faint">{t("team_setup.field_scheduling_help")}</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button className={BTN_ACCENT} disabled={!canRegister} onClick={register}>
                {busy ? t("team_setup.registering") : t("team_setup.register_button")}
              </button>
              {msg && <span className="text-[12px] text-muted">{msg}</span>}
            </div>
          </div>

          {consent && consent.length > 0 && (
            <div className="space-y-2 mt-3" data-testid="subagent-consent-review">
              <div className="flex items-start gap-2.5 rounded-xl border border-warnInk/30 bg-warnSoft px-3.5 py-2.5 text-[13px] text-warnInk">
                <Icon name="shield" size={15} className="shrink-0 mt-0.5" />
                <span>{t("team_setup.consent_note")}</span>
              </div>
              {consent.map((c) => (
                <div key={c.id} className={CARD + " p-3.5"}>
                  <div className="text-[13px] font-medium">{c.name}</div>
                  {c.description && <div className="text-[12px] text-muted mt-0.5">{c.description}</div>}
                  <div className="text-[12px] text-muted mt-1.5">
                    {c.connectors === "all"
                      ? t("personas.consent_all_connectors")
                      : c.connectors.length
                        ? t("personas.consent_use_connectors", { list: c.connectors.join(", ") })
                        : ""}
                    {c.mcp.length ? " " + t("personas.consent_use_mcp", { list: c.mcp.join(", ") }) : ""}
                  </div>
                  <button
                    className={BTN_ACCENT + " mt-2.5"}
                    onClick={() => updatePersona(c.id, { enabled: true, surfaced: false }).then(onPersonasChanged)}
                  >
                    {t("personas.enable_coworker")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
