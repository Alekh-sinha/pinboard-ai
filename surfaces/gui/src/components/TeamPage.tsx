import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createSkill,
  deleteSkill,
  getPersonasIndex,
  getPersonaSkills,
  type Persona,
  type SkillRow,
} from "../api";
import { fullPersonaName } from "../personaScope";
import { showWorkerRegistration } from "../flags";
import { PanelHead } from "./IntegrationsView";
import { PersonaGlyph } from "./personaIcon";
import { WorkerRegistrationSection } from "./WorkerRegistrationSection";

// The Team page (Team page plan, C2): reached from the composer's "+" → Persona →
// Team, a whole surface rather than a flyout since staffing/team concerns deserve
// more room than a dropdown. Two boxes:
//   - Lead: pick any team:lead persona (existing ones + general-lead), same
//     pickCoworker mechanism the Solo picker/SessionSetupRow already use.
//   - Worker: general-worker is always available as the staffing fallback — a lead
//     stages workers conversationally at runtime (propose_team), so there's no human
//     "choose a worker" action needed here. This box is primarily a skill-management
//     panel for it.
// Both boxes get an "add a skill" action scoped separately (B2: scope "lead"/"worker"
// — two dedicated, never-crossing folders under state_dir()/persona-skills/).

const CARD = "rounded-xl2 border border-line bg-panel";
const SEC_H = "text-[11px] uppercase tracking-[0.05em] text-faint font-semibold";
const INPUT =
  "w-full px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const TEXTAREA = INPUT + " resize-y min-h-[64px]";
const BTN_ACCENT = "text-[13px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[13px] px-2.5 py-1.5 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";

function SkillAddForm({
  scope,
  onAdded,
}: {
  scope: "lead" | "worker";
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const r = await createSkill({ name: name.trim(), description: description.trim(), instructions: instructions.trim(), scope });
    setBusy(false);
    if (!r.ok) {
      setMsg(r.error || t("team_page.skill_add_failed"));
      return;
    }
    setName("");
    setDescription("");
    setInstructions("");
    setOpen(false);
    onAdded();
  };

  if (!open) {
    return (
      <button className={BTN_BORDERED} data-testid={`team-add-skill-${scope}`} onClick={() => setOpen(true)}>
        {t("team_page.add_skill")}
      </button>
    );
  }
  return (
    <div className={CARD + " p-3 space-y-2"}>
      <input className={INPUT} placeholder={t("team_page.skill_name")} value={name} onChange={(e) => setName(e.target.value)} />
      <input className={INPUT} placeholder={t("team_page.skill_description")} value={description} onChange={(e) => setDescription(e.target.value)} />
      <textarea className={TEXTAREA} placeholder={t("team_page.skill_instructions")} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <div className="flex items-center gap-2">
        <button
          className={BTN_ACCENT}
          disabled={busy || !name.trim() || !instructions.trim()}
          onClick={submit}
          data-testid={`team-add-skill-${scope}-save`}
        >
          {busy ? t("team_page.skill_saving") : t("team_page.skill_save")}
        </button>
        <button className={BTN_BORDERED} onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
        {msg && <span className="text-[12px] text-warnInk">{msg}</span>}
      </div>
    </div>
  );
}

function SkillListPanel({ scope }: { scope: "lead" | "worker" }) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const reload = () => getPersonaSkills(scope).then(setSkills).catch(() => setSkills([]));
  useEffect(() => {
    reload();
  }, [scope]);

  return (
    <div>
      <div className={SEC_H + " mb-1.5"}>{t("team_page.skills_title")}</div>
      {skills === null ? (
        <p className="text-[12px] text-faint">{t("team_page.loading")}</p>
      ) : skills.length === 0 ? (
        <p className="text-[12px] text-faint mb-2.5">{t("team_page.skills_empty")}</p>
      ) : (
        <div className={CARD + " divide-y divide-line mb-2.5"}>
          {skills.map((s) => (
            <div key={s.name} className="px-3.5 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{s.name}</div>
                {s.description && <div className="text-[12px] text-faint truncate mt-0.5">{s.description}</div>}
              </div>
              <button
                className="text-faint hover:text-danger shrink-0"
                aria-label={t("common.remove")}
                onClick={() => deleteSkill(s.name).then(() => reload())}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <SkillAddForm scope={scope} onAdded={reload} />
    </div>
  );
}

export function TeamPage({
  agent,
  onPickCoworker,
  onManageCoworkers,
}: {
  agent?: string;
  onPickCoworker: (id: string) => void;
  onManageCoworkers: () => void;
}) {
  const { t } = useTranslation();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const reloadPersonas = () => getPersonasIndex().then((r) => setPersonas(r.personas)).catch(() => {});
  useEffect(() => {
    reloadPersonas();
  }, []);

  const leads = personas.filter((p) => p.enabled && p.team === "lead");

  return (
    <main className="flex-1 min-w-0 overflow-y-auto hairline-scroll bg-paper">
      <div className="max-w-3xl mx-auto px-7 py-6">
        <PanelHead title={t("team_page.title")} sub={t("team_page.intro")} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Lead box */}
          <section className="space-y-4">
            <div className={SEC_H}>{t("team_page.lead_box_title")}</div>
            {leads.length === 0 ? (
              <p className="text-[12px] text-faint">{t("team_page.lead_box_empty")}</p>
            ) : (
              <div className={CARD + " divide-y divide-line"}>
                {leads.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`team-lead-${p.id}`}
                    className={
                      "w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-paper " +
                      (p.id === agent ? "bg-accentSoft/50" : "")
                    }
                    onClick={() => onPickCoworker(p.id)}
                  >
                    <PersonaGlyph icon={p.icon} folderScoped={p.requires_folder} size={16} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{fullPersonaName(p.name, p.id)}</span>
                      {p.tagline && <span className="block text-[12px] text-faint truncate">{p.tagline}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button className={BTN_BORDERED} onClick={onManageCoworkers}>
              {t("setup.manage_coworkers")}
            </button>
            <SkillListPanel scope="lead" />
          </section>

          {/* Worker box */}
          <section className="space-y-4">
            <div className={SEC_H}>{t("team_page.worker_box_title")}</div>
            <div className={CARD + " px-3.5 py-3"}>
              <div className="text-[13px] font-medium">{t("team_page.general_worker_name")}</div>
              <div className="text-[12px] text-faint mt-0.5">{t("team_page.general_worker_desc")}</div>
            </div>
            <SkillListPanel scope="worker" />
            {showWorkerRegistration() && (
              <div>
                <div className="my-2 border-t border-line" />
                <div className={SEC_H + " mb-2"}>{t("team_page.custom_worker_title")}</div>
                <WorkerRegistrationSection personas={personas} onPersonasChanged={reloadPersonas} onRegistered={setPersonas} />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
