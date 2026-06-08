import { useEffect, useRef, useState } from "react";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { api } from "../../../api/client";
import { useAuthStore } from "../../../stores/auth-store";
import { useActiveNote, useNotesStore } from "../../../stores/notes-store";
import type { Note, NoteStatus } from "../../../shared/api/notes";
import { isAuraBlogProject } from "../aura-blog";
import { isAuraWhitepaperProject } from "../aura-whitepaper";
import styles from "./NotesInfoPanel.module.css";

function formatDate(iso?: string | null): string {
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
function formatDateOnly(iso?: string | null): string {
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
 * Resolve the note's author/creator for display, falling back to the
 * current user's display name when the stored value is still a raw
 * user_id from the pre-display-name era.
 */
function resolveCreatedBy(
  value: string | null | undefined,
  selfUserId: string | null | undefined,
  selfDisplayName: string | null | undefined,
): string {
  if (!value) return "—";
  if (UUID_RE.test(value) && selfUserId && value === selfUserId) {
    return selfDisplayName || value;
  }
  return value;
}

/** Title-case a status string (e.g. "draft" -> "Draft"). */
function formatStatus(status?: string | null): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Editable CMS controls shown in the Info panel when the active note
 * lives in one of the reserved CMS projects (aura-blog or
 * aura-whitepaper). Lets sys admins edit metadata and publish/unpublish.
 * The backend independently enforces that only sys admins may write to
 * these projects. Local input state is keyed on `noteId` so switching
 * notes (or a store refresh) re-seeds it. When `isWhitepaper` is set the
 * labels are tuned for the whitepaper (the `blogType` field doubles as
 * the collapsible section key on the public `/os` page).
 */
function BlogCmsSection({
  projectId,
  noteId,
  meta,
  isWhitepaper = false,
}: {
  projectId: string;
  noteId: string;
  meta: Note;
  isWhitepaper?: boolean;
}) {
  const patchNoteMeta = useNotesStore((s) => s.patchNoteMeta);

  const [blogType, setBlogType] = useState(meta.blogType ?? "");
  const [excerpt, setExcerpt] = useState(meta.excerpt ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(meta.heroImageUrl ?? "");
  const [readTime, setReadTime] = useState(
    meta.readTimeMinutes != null ? String(meta.readTimeMinutes) : "",
  );
  const [busy, setBusy] = useState(false);

  // Re-seed the form whenever the active note changes (or its metadata is
  // refreshed in the store), so the inputs always reflect the latest row.
  useEffect(() => {
    setBlogType(meta.blogType ?? "");
    setExcerpt(meta.excerpt ?? "");
    setHeroImageUrl(meta.heroImageUrl ?? "");
    setReadTime(meta.readTimeMinutes != null ? String(meta.readTimeMinutes) : "");
  }, [noteId, meta.blogType, meta.excerpt, meta.heroImageUrl, meta.readTimeMinutes]);

  const isPublished = meta.status === "published";

  /** Persist a single blog field on blur, skipping no-op writes. */
  async function commitField(
    patch: Parameters<typeof api.notes.updateNote>[2],
  ): Promise<void> {
    try {
      const updated = await api.notes.updateNote(projectId, noteId, patch);
      patchNoteMeta(projectId, noteId, updated);
    } catch (err) {
      console.warn("update blog field failed", err);
    }
  }

  async function transition(status: NoteStatus): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.notes.transitionNote(projectId, noteId, status);
      patchNoteMeta(projectId, noteId, updated);
    } catch (err) {
      console.warn("transition note failed", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.cmsSection}>
      <div className={styles.cmsHeading}>
        {isWhitepaper ? "Whitepaper section" : "Blog post"}
      </div>

      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>Status</span>
        <div className={styles.cmsStatusRow}>
          <span
            className={`${styles.statusPill} ${
              isPublished ? styles.statusPublished : styles.statusDraft
            }`}
          >
            {isPublished ? "Published" : "Draft"}
          </span>
          <button
            type="button"
            className={styles.cmsButton}
            disabled={busy}
            onClick={() => transition(isPublished ? "draft" : "published")}
          >
            {isPublished ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      {isPublished ? (
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Published at</span>
          <span className={styles.infoValue}>{formatDate(meta.publishedAt)}</span>
        </div>
      ) : null}

      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>
          {isWhitepaper ? "Section" : "Blog type"}
        </span>
        <input
          className={styles.cmsInput}
          type="text"
          value={blogType}
          placeholder={isWhitepaper ? "e.g. harness" : "e.g. announcement"}
          onChange={(e) => setBlogType(e.target.value)}
          onBlur={() => {
            if ((meta.blogType ?? "") !== blogType) {
              void commitField({ blogType });
            }
          }}
        />
      </div>

      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>Excerpt</span>
        <textarea
          className={styles.cmsTextarea}
          value={excerpt}
          rows={3}
          placeholder="Short summary shown in listings"
          onChange={(e) => setExcerpt(e.target.value)}
          onBlur={() => {
            if ((meta.excerpt ?? "") !== excerpt) {
              void commitField({ excerpt });
            }
          }}
        />
      </div>

      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>Hero image URL</span>
        <input
          className={styles.cmsInput}
          type="text"
          value={heroImageUrl}
          placeholder="https://…"
          onChange={(e) => setHeroImageUrl(e.target.value)}
          onBlur={() => {
            if ((meta.heroImageUrl ?? "") !== heroImageUrl) {
              void commitField({ heroImageUrl });
            }
          }}
        />
      </div>

      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>Read time (min)</span>
        <input
          className={styles.cmsInput}
          type="number"
          min={0}
          value={readTime}
          placeholder="0"
          onChange={(e) => setReadTime(e.target.value)}
          onBlur={() => {
            const trimmed = readTime.trim();
            const parsed = trimmed === "" ? undefined : Number(trimmed);
            if (parsed != null && Number.isNaN(parsed)) return;
            const current = meta.readTimeMinutes ?? undefined;
            if (parsed !== current) {
              void commitField({ readTimeMinutes: parsed });
            }
          }}
        />
      </div>
    </div>
  );
}

export function NotesInfoPanel() {
  const note = useActiveNote();
  const user = useAuthStore((s) => s.user);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!note) {
    // Auto-selection fills the active note moments after mount; avoid a
    // flashing placeholder in the meantime.
    return <div className={styles.panel} />;
  }

  const meta = note.note;
  const createdBy = resolveCreatedBy(
    meta.authorName ?? meta.createdBy,
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
          <span className={styles.infoLabel}>Created at</span>
          <span className={styles.infoValue}>
            {formatDateOnly(meta.createdAt)}
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
        {isAuraBlogProject(meta.projectId) ||
        isAuraWhitepaperProject(meta.projectId) ? (
          <BlogCmsSection
            projectId={meta.projectId as string}
            noteId={meta.id}
            meta={meta}
            isWhitepaper={isAuraWhitepaperProject(meta.projectId)}
          />
        ) : (
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Status</span>
            <span className={styles.infoValue}>{formatStatus(meta.status)}</span>
          </div>
        )}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
