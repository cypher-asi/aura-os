import { useNotesStore } from "../../../stores/notes-store";
import { NotesInfoPanel } from "../NotesInfoPanel";
import { NotesCommentsPanel } from "../NotesCommentsPanel";

/**
 * Tab router for the right-hand Notes sidekick. Picks between the Info and
 * Comments panels based on the active sidekick tab; keeps the two panels
 * truly independent so each owns its own state, effects, and CSS module.
 */
export function NotesSidekickPanel() {
  const sidekickTab = useNotesStore((s) => s.sidekickTab);
  if (sidekickTab === "comments") return <NotesCommentsPanel />;
  return <NotesInfoPanel />;
}
