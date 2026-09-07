import { useTranslation } from "react-i18next";

// "For general-lead / general-worker / both" (Team page plan, C3): reuses the existing
// per-persona connections mechanism (POST /v1/personas/{id}/connections,
// setPersonaConnection in api.ts) against the two fixed, always-known ids — no new
// backend, no role-scoped store. A connector with no opinion yet is already ON by
// default for both (connections.py's effective(): "connected, no opinion → inherit
// on") since general-lead/general-worker declare `connectors: all` with no
// `recommends:` — these two checkboxes are how a user explicitly MUTES one for lead,
// worker, or both, not how access is granted in the first place.

export function GeneralTeamToggle({
  leadOn,
  workerOn,
  onToggleLead,
  onToggleWorker,
}: {
  leadOn: boolean;
  workerOn: boolean;
  onToggleLead: (next: boolean) => void;
  onToggleWorker: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <span
      className="flex items-center gap-2.5 text-[11px] text-muted shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1 cursor-pointer" title={t("role_defaults.scope_lead")}>
        <input
          type="checkbox"
          data-testid="general-lead-toggle"
          checked={leadOn}
          onChange={(e) => onToggleLead(e.target.checked)}
        />
        {t("role_defaults.scope_lead")}
      </label>
      <label className="flex items-center gap-1 cursor-pointer" title={t("role_defaults.scope_general_worker")}>
        <input
          type="checkbox"
          data-testid="general-worker-toggle"
          checked={workerOn}
          onChange={(e) => onToggleWorker(e.target.checked)}
        />
        {t("role_defaults.scope_general_worker")}
      </label>
    </span>
  );
}
