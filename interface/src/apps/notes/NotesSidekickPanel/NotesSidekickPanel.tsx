import { useNotesStore } from "../../../stores/notes-store";
import { NotesInfoPanel } from "../NotesInfoPanel";
import { NotesCommentsPanel } from "../NotesCommentsPanel";
import { NotesTocPanel } from "../NotesTocPanel";

/**
 * Tab router for the right-hand Notes sidekick. Picks between the TOC,
 * Info, and Comments panels based on the active sidekick tab; keeps each
 * panel independent so they own their own state, effects, and CSS module.
 */
export function NotesSidekickPanel() {
  const sidekickTab = useNotesStore((s) => s.sidekickTab);
  if (sidekickTab === "comments") return <NotesCommentsPanel />;
  if (sidekickTab === "info") return <NotesInfoPanel />;
  return <NotesTocPanel />;
}
