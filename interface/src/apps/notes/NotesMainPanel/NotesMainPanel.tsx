import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { Lane } from "../../../components/Lane";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useActiveNote,
  useActiveNoteKey,
  useNotesStore,
} from "../../../stores/notes-store";
import { BubbleToolbar } from "./BubbleToolbar";
import styles from "./NotesMainPanel.module.css";

/** Narrow a TipTap editor's `storage` field to the slice the markdown
 *  extension adds. `tiptap-markdown` augments it at runtime without
 *  extending the `Editor` type, so this keeps the cast in one place. */
function getMarkdownStorage(editor: Editor): { getMarkdown: () => string } {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  if (!storage.markdown) {
    throw new Error(
      "tiptap-markdown storage missing — Markdown extension must be registered on the editor.",
    );
  }
  return storage.markdown;
}

type EditMode = "wysiwyg" | "markdown";

function parseMdFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---")) {
    return { frontmatter: "", body: content };
  }
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: "", body: content };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: "", body: content };
  }
  const frontmatter = lines.slice(0, end + 1).join("\n");
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  return { frontmatter, body };
}

function rejoinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  const trimmedBody = body.replace(/^\n+/, "");
  return `${frontmatter}\n\n${trimmedBody}`;
}

export function NotesMainPanel({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string; notePath: string }>();
  const note = useActiveNote();
  const activeKey = useActiveNoteKey();
  const selectNote = useNotesStore((s) => s.selectNote);
  const updateContent = useNotesStore((s) => s.updateContent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<EditMode>("wysiwyg");
  const lastSyncedKey = useRef<string | null>(null);

  // Gate the note body on a post-commit layout pass. When mounting after an
  // app switch (e.g. desktop mode → Notes), the sidebar expands in the same
  // commit that mounts us; the `--left-panel-width` CSS variable that
  // `centerColumn` depends on for horizontal positioning is updated in a
  // parent layout effect. React runs child layout effects before parent
  // layout effects, so on the first render our content could paint against
  // a stale variable and flicker in the center before snapping to its final
  // column. We start the column hidden and reveal it via direct DOM mutation
  // in a layout effect, which runs after both our own and the parent's
  // effects have reconciled layout. We mutate the DOM (rather than drive
  // visibility through React state) so we don't trigger a cascading re-render
  // on every mount.
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const firstLayoutDoneRef = useRef(false);
  const setCenterColumnRef = useCallback((el: HTMLDivElement | null) => {
    centerColumnRef.current = el;
    if (el && !firstLayoutDoneRef.current) {
      el.style.visibility = "hidden";
    }
  }, []);
  useLayoutEffect(() => {
    if (firstLayoutDoneRef.current) return;
    const el = centerColumnRef.current;
    if (!el) return;
    // Force a style/layout flush so the reveal happens against the final
    // positioning (parent effects have run by now, updating CSS vars).
    el.getBoundingClientRect();
    el.style.visibility = "";
    firstLayoutDoneRef.current = true;
  });

  // Single source of truth for URL <-> store reconciliation. The URL is the
  // authority for "which note is shown": when it changes (user navigated,
  // clicked in the nav, etc.) we pull the store onto it. The store is only
  // allowed to drive the URL when the URL is stable and activeKey has drifted
  // (i.e. an autosave rename changed the relPath under us). Splitting these
  // into two effects lets them oscillate — zustand and react-router have
  // independent subscriptions, so a single click can produce a render where
  // URL and activeKey disagree; each effect then "corrects" the other's side,
  // producing an infinite swap and an HTTP storm of reads.
  const lastUrlSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!params.projectId || !params.notePath) return;
    const decoded = decodeURIComponent(params.notePath);
    const urlKey = `${params.projectId}::${decoded}`;

    if (lastUrlSelectedRef.current !== urlKey) {
      lastUrlSelectedRef.current = urlKey;
      if (
        activeKey?.projectId !== params.projectId ||
        activeKey?.relPath !== decoded
      ) {
        selectNote(params.projectId, decoded);
      }
      return;
    }

    if (
      activeKey &&
      activeKey.projectId === params.projectId &&
      activeKey.relPath !== decoded
    ) {
      navigate(
        `/notes/${activeKey.projectId}/${encodeURIComponent(activeKey.relPath)}`,
        { replace: true },
      );
    }
  }, [params.projectId, params.notePath, activeKey, selectNote, navigate]);

  // When the URL lacks `:notePath`, auto-selection is handled by
  // `NotesIndexRedirect` — which only mounts on `/notes` and
  // `/notes/:projectId` routes. Keeping that logic out of the editor panel
  // prevents it from firing during an outgoing app switch (e.g. Notes →
  // Feedback) and hijacking the new route.

  const { frontmatter, body } = useMemo(() => {
    if (!note) return { frontmatter: "", body: "" };
    return parseMdFrontmatter(note.content);
  }, [note]);

  // Ref-latched snapshots so the (stable) editor's onUpdate closure always
  // dispatches against the current active note, even after an autosave
  // rename has changed the relPath under us.
  const activeKeyRef = useRef(activeKey);
  const frontmatterRef = useRef(frontmatter);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  useEffect(() => {
    frontmatterRef.current = frontmatter;
  }, [frontmatter]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          codeBlock: { HTMLAttributes: { class: "code-block" } },
          link: { openOnClick: false, autolink: true },
        }),
        Placeholder.configure({
          placeholder: "Start typing your note...",
        }),
        Markdown.configure({
          html: false,
          tightLists: true,
          linkify: true,
          breaks: false,
          transformPastedText: true,
        }),
      ],
      content: body,
      onUpdate: ({ editor: ed }) => {
        const current = activeKeyRef.current;
        if (!current) return;
        const md = getMarkdownStorage(ed).getMarkdown();
        const joined = rejoinFrontmatter(frontmatterRef.current, md);
        updateContent(current.projectId, current.relPath, joined);
      },
      editorProps: {
        attributes: {
          class: styles.editor,
          spellcheck: "false",
        },
      },
    },
    // Re-init on project change only. Note renames (caused by autosave
    // syncing filename to the first-line title) just swap relPath without
    // changing content, so we keep the same editor instance to preserve the
    // caret/selection.
    [activeKey?.projectId],
  );

  useEffect(() => {
    if (!editor || !note || !activeKey) return;
    const key = `${activeKey.projectId}::${activeKey.relPath}`;
    if (lastSyncedKey.current === key) return;
    lastSyncedKey.current = key;
    const currentMd = getMarkdownStorage(editor).getMarkdown();
    // Skip setContent when the body is already in sync (e.g. we're only
    // reacting to an autosave rename, not a genuine note switch). setContent
    // clears the selection, which would otherwise be jarring mid-typing.
    if (currentMd.trim() === body.trim()) return;
    editor.commands.setContent(body, { emitUpdate: false });
  }, [editor, note, activeKey, body]);

  const handleMarkdownEdit = useCallback(
    (text: string) => {
      if (!activeKey) return;
      const joined = rejoinFrontmatter(frontmatter, text);
      updateContent(activeKey.projectId, activeKey.relPath, joined);
      if (editor && mode === "markdown") {
        lastSyncedKey.current = null;
      }
    },
    [activeKey, frontmatter, updateContent, editor, mode],
  );

  const handleModeChange = useCallback(
    (next: EditMode) => {
      setMode(next);
      if (next === "wysiwyg" && editor) {
        editor.commands.setContent(body, { emitUpdate: false });
        lastSyncedKey.current = activeKey
          ? `${activeKey.projectId}::${activeKey.relPath}`
          : null;
      }
    },
    [editor, body, activeKey],
  );

  const saveState = useMemo(() => {
    if (!note) return "";
    if (note.error) return `Save failed: ${note.error}`;
    if (note.dirty) return "Saving…";
    if (note.updatedAt) {
      try {
        const d = new Date(note.updatedAt);
        return `Saved ${d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      } catch {
        return "Saved";
      }
    }
    return "";
  }, [note]);

  if (!params.projectId || !params.notePath) {
    // `NotesIndexRedirect` is the route element for `/notes` and
    // `/notes/:projectId`; it mounts inside this lane (via `children`) and
    // issues a `Navigate` to a concrete note path.
    return (
      <Lane flex>
        <div className={styles.container}>{children}</div>
      </Lane>
    );
  }

  return (
    <Lane flex>
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.modeToggle} role="tablist" aria-label="Editor mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "wysiwyg"}
              data-active={mode === "wysiwyg"}
              className={styles.modeButton}
              onClick={() => handleModeChange("wysiwyg")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") handleModeChange("markdown");
              }}
            >
              Rich
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "markdown"}
              data-active={mode === "markdown"}
              className={styles.modeButton}
              onClick={() => handleModeChange("markdown")}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") handleModeChange("wysiwyg");
              }}
            >
              Markdown
            </button>
          </div>
        </div>
        <div ref={scrollRef} className={styles.scrollArea}>
          <div
            ref={setCenterColumnRef}
            className={`${styles.centerColumn} ${
              mode === "markdown" ? styles.centerColumnMarkdown : ""
            }`}
          >
            {!note ? null : mode === "wysiwyg" && editor ? (
              <>
                <BubbleMenu
                  editor={editor}
                  options={{ placement: "top" }}
                  className={styles.bubbleMenu}
                >
                  <BubbleToolbar editor={editor} />
                </BubbleMenu>
                <EditorContent editor={editor} />
              </>
            ) : (
              <textarea
                className={styles.markdownArea}
                value={body}
                onChange={(e) => handleMarkdownEdit(e.target.value)}
                spellCheck={false}
                aria-label="Note body (markdown)"
              />
            )}
          </div>
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
        {saveState ? (
          <span
            className={`${styles.saveState} ${note?.error ? styles.saveStateError : ""}`}
            aria-live="polite"
          >
            {saveState}
          </span>
        ) : null}
      </div>
    </Lane>
  );
}
