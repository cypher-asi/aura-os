import { useRef } from "react";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useAuthStore } from "../../../stores/auth-store";
import { useActiveNote, useNotesStore } from "../../../stores/notes-store";
import styles from "./NotesInfoPanel.module.css";

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Date-only formatter for the "Created at" row (time is redundant there). */
function formatDateOnly(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Display the `created_by` frontmatter value, falling back to the current
 * user's display name when the stored value is still a raw user_id from the
 * pre-display-name era. Any other non-empty string is passed through, so
 * display names authored by other users still render correctly.
 */
function resolveCreatedBy(
  value: string | undefined,
  selfUserId: string | null | undefined,
  selfDisplayName: string | null | undefined,
): string {
  if (!value) return "—";
  if (UUID_RE.test(value) && selfUserId && value === selfUserId) {
    return selfDisplayName || value;
  }
  return value;
}

export function NotesInfoPanel() {
  const note = useActiveNote();
  const revealInFolder = useNotesStore((s) => s.revealInFolder);
  const user = useAuthStore((s) => s.user);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!note) {
    // Auto-selection fills the active note moments after mount; avoid a
    // flashing placeholder in the meantime.
    return <div className={styles.panel} />;
  }

  const createdBy = resolveCreatedBy(
    note.frontmatter.created_by,
    user?.user_id,
    user?.display_name,
  );

  return (
    <div className={styles.panel}>
      <div ref={scrollRef} className={styles.infoList}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Title</span>
          <span className={styles.infoValue}>{note.title || "Untitled"}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Location</span>
          <button
            type="button"
            className={styles.pathButton}
            onClick={() => void revealInFolder(note.absPath)}
            title="Open containing folder"
          >
            {note.absPath}
          </button>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Created at</span>
          <span className={styles.infoValue}>
            {formatDateOnly(note.frontmatter.created_at)}
          </span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Created by</span>
          <span className={styles.infoValue}>{createdBy}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Last updated</span>
          <span className={styles.infoValue}>{formatDate(note.updatedAt)}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Word count</span>
          <span className={styles.infoValue}>{note.wordCount}</span>
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
