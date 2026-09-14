import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  confirmSkillUpload,
  createSkill,
  getPersonasIndex,
  getPersonaSkills,
  stageSkillUpload,
  updateSkill,
  type Persona,
  type SkillRow,
  type SkillUploadPreview,
} from "../api";
import { showWorkerRegistration } from "../flags";
import { Icon } from "./Icon";
import { PanelHead } from "./IntegrationsView";
import { SelectMenu } from "./SelectMenu";
import { WorkerRegistrationSection } from "./WorkerRegistrationSection";

// The Team page (Team page plan, C2): a Lead/Worker role selector — each a dropdown
// over every currently enabled persona of that team type, defaulting to the always-
// available general-lead/general-worker — driving a single skills-management area
// below it: scope "lead"/"worker", the shared pool ANY enabled lead/worker now draws
// on (2026-09-13 widening of persona_skill_scope() — additive with a specialist's own
// bundled skills, never replacing them; see manager.py).
//
// Redesign v3 (owner ask 2026-09-13, against a supplied reference image + a live
// comparison pass): v2 fixed the *structure* (one selector switching a persistent,
// always-visible skills area) but kept the app's existing near-white accentSoft/
// tealSoft tokens for the icon badges, which read as flat/pale next to the reference.
// This version gives the badges their own, more saturated tokens (styles.css:
// --badge-{blue,purple,green}-{bg,fg}) — real color presence without switching to a
// different (multi-tone, illustrated) icon style than the rest of the app uses.

const CARD = "rounded-xl2 border border-line bg-panel";
const SEC_H = "text-[11px] uppercase tracking-[0.05em] text-faint font-semibold";
const FIELD_LABEL = "text-[12px] font-medium text-muted";
const INPUT =
  "w-full px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const TEXTAREA = INPUT + " resize-y min-h-[88px]";
const BTN_ACCENT = "text-[13px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[13px] px-2.5 py-1.5 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";

function Badge({ tone, children }: { tone: "blue" | "purple" | "green"; children: React.ReactNode }) {
  const cls =
    tone === "blue" ? "bg-badgeBlueBg text-badgeBlueFg"
    : tone === "purple" ? "bg-badgePurpleBg text-badgePurpleFg"
    : "bg-badgeGreenBg text-badgeGreenFg";
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${cls}`}>
      {children}
    </span>
  );
}

async function fileToB64(file: File): Promise<string> {
  // FileReader fallback: File.arrayBuffer is missing in some webviews (and jsdom).
  const buf =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as ArrayBuffer);
          r.onerror = () => reject(r.error);
          r.readAsArrayBuffer(file);
        });
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// One wide row, two radio-style cards. Each carries a dropdown over every enabled
// persona of that team type — picking a different one updates the card and (for
// leads only) becomes the active coworker; picking a worker never launches a
// session, workers aren't started directly.
function RoleCard({
  tone,
  icon,
  active,
  onActivate,
  options,
  selectedId,
  onPick,
  emptyLabel,
  testId,
  selectAria,
}: {
  tone: "blue" | "purple";
  icon: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  onActivate: () => void;
  options: Persona[];
  selectedId: string;
  onPick: (id: string) => void;
  emptyLabel: string;
  testId: string;
  selectAria: string;
}) {
  const current = options.find((p) => p.id === selectedId);
  return (
    <div
      data-testid={testId}
      onClick={onActivate}
      className={
        "flex-1 min-w-0 text-left rounded-xl2 border p-4 flex items-start gap-3 cursor-pointer transition-colors " +
        (active ? "border-accent bg-accentSoft/40" : "border-line bg-panel hover:border-lineStrong")
      }
    >
      <Badge tone={tone}><Icon name={icon} size={16} /></Badge>
      <div className="min-w-0 flex-1">
        {options.length === 0 ? (
          <span className="block text-[14px] font-semibold text-faint">{emptyLabel}</span>
        ) : (
          // stopPropagation: the dropdown's own click (including its listbox, which
          // renders as a DOM descendant here) must not also bubble into the card's
          // onActivate — that would re-fire with THIS render's now-stale selectedId
          // and clobber whatever onPick just chose.
          <div onClick={(e) => e.stopPropagation()}>
            <SelectMenu
              ariaLabel={selectAria}
              value={selectedId}
              options={options.map((p) => ({ value: p.id, label: p.name, sub: p.tagline }))}
              onChange={onPick}
            />
            {current?.tagline && (
              <span className="block text-[12px] text-muted mt-1.5 leading-relaxed">{current.tagline}</span>
            )}
          </div>
        )}
      </div>
      <span
        className={
          "mt-1 shrink-0 w-4 h-4 rounded-full border-2 " +
          (active ? "border-accent bg-accent" : "border-lineStrong")
        }
        aria-hidden
      />
    </div>
  );
}

function SkillAddForm({
  scope,
  onAdded,
}: {
  scope: "lead" | "worker";
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"write" | "upload">("write");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [upload, setUpload] = useState<SkillUploadPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset the form whenever the role changes so stale text/upload previews don't
  // leak from one scope's form into the other.
  useEffect(() => {
    setName("");
    setDescription("");
    setInstructions("");
    setUpload(null);
    setMsg(null);
    setTab("write");
  }, [scope]);

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
    onAdded();
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const res = await stageSkillUpload(await fileToB64(file), file.name);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || t("team_page.skill_add_failed"));
      return;
    }
    setUpload(res);
  };

  const confirmUpload = async () => {
    if (!upload?.token) return;
    setBusy(true);
    const res = await confirmSkillUpload(upload.token, scope);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || t("team_page.skill_add_failed"));
      return;
    }
    setUpload(null);
    onAdded();
  };

  return (
    <div className={CARD + " p-4"}>
      <div className="flex gap-1 border-b border-line mb-3.5">
        <button
          className={"text-[13px] px-3 py-2 -mb-px border-b-2 " + (tab === "write" ? "border-accent text-ink font-medium" : "border-transparent text-muted")}
          data-testid={`team-skill-tab-write-${scope}`}
          onClick={() => setTab("write")}
        >
          {t("team_page.tab_write")}
        </button>
        <button
          className={"text-[13px] px-3 py-2 -mb-px border-b-2 " + (tab === "upload" ? "border-accent text-ink font-medium" : "border-transparent text-muted")}
          data-testid={`team-skill-tab-upload-${scope}`}
          onClick={() => setTab("upload")}
        >
          {t("team_page.tab_upload")}
        </button>
      </div>

      {tab === "write" ? (
        <div className="space-y-3">
          <div>
            <label className={FIELD_LABEL}>{t("team_page.skill_name")}</label>
            <input className={INPUT + " mt-1"} placeholder={t("team_page.skill_name_placeholder")} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={FIELD_LABEL}>{t("team_page.skill_description")}</label>
            <input className={INPUT + " mt-1"} placeholder={t("team_page.skill_description_placeholder")} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className={FIELD_LABEL}>{t("team_page.skill_instructions")}</label>
            <textarea className={TEXTAREA + " mt-1"} placeholder={t("team_page.skill_instructions_placeholder")} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              className={BTN_ACCENT}
              disabled={busy || !name.trim() || !instructions.trim()}
              onClick={submit}
              data-testid={`team-skill-save-${scope}`}
            >
              {busy ? t("team_page.skill_saving") : t("team_page.skill_save")}
            </button>
            {msg && <span className="text-[12px] text-warnInk">{msg}</span>}
          </div>
        </div>
      ) : upload ? (
        <div>
          <div className="text-[13px] mb-1">
            <span className="font-medium">{upload.name}</span>
            {upload.description && <span className="text-muted"> — {upload.description}</span>}
          </div>
          <pre className="text-[12px] bg-paper border border-line rounded-lg p-2.5 whitespace-pre-wrap max-h-40 overflow-y-auto mb-2">
            {upload.instructions}
          </pre>
          {upload.files?.length ? (
            <div className="text-[12px] text-muted mb-2">{t("skills.bundled_files", { files: upload.files.join(", ") })}</div>
          ) : null}
          <div className="flex items-center gap-2">
            <button className={BTN_ACCENT} disabled={busy} onClick={confirmUpload} data-testid={`team-skill-confirm-upload-${scope}`}>
              {busy ? t("team_page.skill_saving") : t("skills.install_skill")}
            </button>
            <button className={BTN_BORDERED} onClick={() => { setUpload(null); setMsg(null); }}>
              {t("common.cancel")}
            </button>
            {msg && <span className="text-[12px] text-warnInk">{msg}</span>}
          </div>
        </div>
      ) : (
        <div>
          <button
            className="w-full flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-lineStrong px-4 py-8 text-center hover:border-accent hover:bg-accentSoft/30 transition-colors"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="folder" size={22} className="text-faint" />
            <span className="text-[13px] font-medium">{t("team_page.upload_cta")}</span>
            <span className="text-[12px] text-faint">{t("team_page.upload_formats")}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.md"
            className="hidden"
            data-testid={`team-skill-upload-input-${scope}`}
            aria-label={t("team_page.upload_cta")}
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {msg && <div className="text-[12px] text-warnInk mt-2">{msg}</div>}
        </div>
      )}
    </div>
  );
}

function SkillListPanel({ scope, reloadKey }: { scope: "lead" | "worker"; reloadKey: number }) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  useEffect(() => {
    setSkills(null);
    getPersonaSkills(scope).then(setSkills).catch(() => setSkills([]));
  }, [scope, reloadKey]);

  const toggle = (row: SkillRow) =>
    updateSkill(row.name, { enabled: !row.enabled }).then(() =>
      setSkills((cur) => cur?.map((s) => (s.name === row.name ? { ...s, enabled: !s.enabled } : s)) ?? cur),
    );

  return (
    <div className={CARD + " p-4"}>
      <div className={SEC_H + " mb-1"}>{t("team_page.current_skills")}{skills ? ` (${skills.length})` : ""}</div>
      <p className="text-[12px] text-muted mb-3 leading-relaxed">{t("team_page.current_skills_sub")}</p>
      {skills === null ? (
        <p className="text-[12px] text-faint">{t("team_page.loading")}</p>
      ) : skills.length === 0 ? (
        <p className="text-[12px] text-faint">{t("team_page.skills_empty")}</p>
      ) : (
        <div className="rounded-lg border border-line divide-y divide-line">
          {skills.map((s) => (
            <div key={s.name} className="px-3 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className={"text-[13px] font-medium truncate " + (s.enabled ? "" : "text-faint")}>{s.name}</div>
                {s.description && <div className="text-[12px] text-faint truncate mt-0.5">{s.description}</div>}
              </div>
              <button
                className={"text-[11px] px-2 py-1 rounded-full border shrink-0 " + (s.enabled ? "border-line text-muted hover:border-lineStrong" : "border-accent text-accent")}
                onClick={() => toggle(s)}
              >
                {s.enabled ? t("team_page.skill_disable") : t("team_page.skill_enable")}
              </button>
            </div>
          ))}
        </div>
      )}
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
  const [role, setRole] = useState<"lead" | "worker">(agent === "general-worker" ? "worker" : "lead");
  // The user's explicit pick, if any — a raw id that may not (yet, or ever) be in the
  // current persona list. Display always goes through the derived ids below instead of
  // this directly, so there's never a flash of an invalid/unresolved id on first paint.
  const [pickedLeadId, setPickedLeadId] = useState<string | null>(
    agent && agent !== "general-worker" ? agent : null,
  );
  const [pickedWorkerId, setPickedWorkerId] = useState<string | null>(null);
  const [skillsBump, setSkillsBump] = useState(0);
  const reloadPersonas = () => getPersonasIndex().then((r) => setPersonas(r.personas)).catch(() => {});
  useEffect(() => {
    reloadPersonas();
  }, []);

  const leads = personas.filter((p) => p.enabled && p.team === "lead");
  const workers = personas.filter((p) => p.enabled && p.team === "worker");

  // Settle on a real, currently-valid default synchronously: the explicit pick if it's
  // still in the list, else general-lead/general-worker if enabled, else whatever's
  // first. Derived every render — never a stale/invalid id sitting in state.
  const leadId =
    (pickedLeadId && leads.some((p) => p.id === pickedLeadId) ? pickedLeadId : null) ||
    leads.find((p) => p.id === "general-lead")?.id ||
    leads[0]?.id ||
    "";
  const workerId =
    (pickedWorkerId && workers.some((p) => p.id === pickedWorkerId) ? pickedWorkerId : null) ||
    workers.find((p) => p.id === "general-worker")?.id ||
    workers[0]?.id ||
    "";

  const pickLead = (id: string) => {
    setPickedLeadId(id);
    setRole("lead");
    onPickCoworker(id);
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto hairline-scroll bg-paper">
      <div className="max-w-3xl mx-auto px-7 py-6">
        <PanelHead title={t("team_page.title")} sub={t("team_page.intro")} />

        <div className="flex flex-col sm:flex-row gap-3 mb-2">
          <RoleCard
            tone="blue"
            icon="sliders"
            active={role === "lead"}
            onActivate={() => (leadId ? pickLead(leadId) : setRole("lead"))}
            options={leads}
            selectedId={leadId}
            onPick={pickLead}
            emptyLabel={t("team_page.lead_box_empty")}
            testId="team-role-lead"
            selectAria={t("team_page.lead_box_title")}
          />
          <RoleCard
            tone="purple"
            icon="wrench"
            active={role === "worker"}
            onActivate={() => setRole("worker")}
            options={workers}
            selectedId={workerId}
            onPick={(id) => { setPickedWorkerId(id); setRole("worker"); }}
            emptyLabel={t("team_page.worker_box_title")}
            testId="team-role-worker"
            selectAria={t("team_page.worker_box_title")}
          />
        </div>
        <button className="text-[12.5px] text-muted hover:text-ink underline decoration-dotted mb-6" onClick={onManageCoworkers}>
          {t("setup.manage_coworkers")}
        </button>

        <div className="mb-3">
          <div className="text-[15px] font-semibold">
            {role === "lead" ? t("team_page.skills_for_lead") : t("team_page.skills_for_worker")}
          </div>
          <p className="text-[13px] text-muted mt-1 leading-relaxed">
            {role === "lead" ? t("team_page.skills_for_lead_sub") : t("team_page.skills_for_worker_sub")}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
          <SkillAddForm scope={role} onAdded={() => setSkillsBump((n) => n + 1)} />
          <SkillListPanel scope={role} reloadKey={skillsBump} />
        </div>

        {showWorkerRegistration() && (
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <Badge tone="purple"><Icon name="gear" size={16} /></Badge>
              <div className={SEC_H}>{t("team_page.custom_worker_title")}</div>
            </div>
            <WorkerRegistrationSection personas={personas} onPersonasChanged={reloadPersonas} onRegistered={setPersonas} />
          </div>
        )}
      </div>
    </main>
  );
}
