// Deterministic paper color + tilt for a sticky-note card, derived from a stable id
// (task id, template key, ...) so a corkboard doesn't reshuffle itself on re-render.
// Shared by ScheduledView (the task board) and AutomationQuickstart (the template
// picker + configure panel) so notes read as one consistent board.
export const NOTE_COLORS = ["note-yellow", "note-pink", "note-blue", "note-green"];

export function noteVariant(id: string): { color: string; rotate: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const color = NOTE_COLORS[h % NOTE_COLORS.length];
  const rotate = (((h >> 4) % 7) - 3) * 0.7; // small, readable tilt: about -2.1..2.1deg
  return { color, rotate };
}
