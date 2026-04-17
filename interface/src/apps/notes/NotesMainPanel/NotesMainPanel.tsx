import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { Lane } from "../../../components/Lane";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useActiveNote,
  useActiveNoteKey,
  useNotesStore,
} from "../../../stores/notes-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { getLastNote } from "../../../utils/storage";
import type { NotesTreeNode } from "../../../api/notes";
import styles from "./NotesMainPanel.module.css";

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

function findFirstNoteRelPath(nodes: NotesTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "note") return node.relPath;
    const found = findFirstNoteRelPath(node.children);
    if (found) return found;
  }
  return null;
}

function treeContainsNote(nodes: NotesTreeNode[], relPath: string): boolean {
  for (const node of nodes) {
    if (node.kind === "note" && node.relPath === relPath) return true;
    if (node.kind === "folder" && treeContainsNote(node.children, relPath)) {
      return true;
    }
  }
  return false;
}

export function NotesMainPanel() {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string; notePath: string }>();
  const note = useActiveNote();
  const activeKey = useActiveNoteKey();
  const selectNote = useNotesStore((s) => s.selectNote);
  const updateContent = useNotesStore((s) => s.updateContent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<EditMode>("wysiwyg");
  const lastSyncedKey = useRef<string | null>(null);

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

  // Landing on `/notes` or `/notes/:projectId` with no note in the URL?
  // Pick a reasonable default: (1) the already-active note in the store,
  // (2) the last note persisted in localStorage (if it still exists),
  // (3) the first note found in any project's tree.
  const trees = useNotesStore((s) => s.trees);
  const projects = useProjectsListStore((s) => s.projects);
  useEffect(() => {
    if (params.notePath) return;

    // Priority 1: session-active note.
    if (activeKey?.projectId && activeKey.relPath) {
      navigate(
        `/notes/${activeKey.projectId}/${encodeURIComponent(activeKey.relPath)}`,
        { replace: true },
      );
      return;
    }

    // Priority 2: last note from localStorage, validated against the live tree.
    const stored = getLastNote();
    if (stored) {
      const tree = trees[stored.projectId];
      if (tree && !tree.loading && treeContainsNote(tree.nodes, stored.relPath)) {
        navigate(
          `/notes/${stored.projectId}/${encodeURIComponent(stored.relPath)}`,
          { replace: true },
        );
        return;
      }
      // Still loading? wait for the next effect run when trees update.
      if (tree?.loading) return;
    }

    // Priority 3: first note from the first project whose tree is ready.
    for (const project of projects) {
      const tree = trees[project.project_id];
      if (!tree || tree.loading) continue;
      const first = findFirstNoteRelPath(tree.nodes);
      if (first) {
        navigate(
          `/notes/${project.project_id}/${encodeURIComponent(first)}`,
          { replace: true },
        );
        return;
      }
    }
  }, [params.notePath, activeKey, trees, projects, navigate]);

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
        }),
        Placeholder.configure({
          placeholder: "Start typing your note...",
        }),
        Link.configure({ openOnClick: false, autolink: true }),
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
        const md = (ed.storage as unknown as {
          markdown: { getMarkdown: () => string };
        }).markdown.getMarkdown();
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
    const currentMd = (editor.storage as unknown as {
      markdown: { getMarkdown: () => string };
    }).markdown.getMarkdown();
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
    // Auto-selection (see effects above) will redirect to a note shortly.
    // Render an empty lane in the meantime so we don't flash a placeholder.
    return (
      <Lane flex>
        <div className={styles.container} />
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
          <div className={styles.centerColumn}>
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

function BubbleToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (
    active: boolean,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className={styles.bubbleButton}
      data-active={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
  return (
    <>
      {btn(editor.isActive("bold"), "Bold", <Bold size={14} />, () =>
        editor.chain().focus().toggleBold().run(),
      )}
      {btn(editor.isActive("italic"), "Italic", <Italic size={14} />, () =>
        editor.chain().focus().toggleItalic().run(),
      )}
      {btn(editor.isActive("strike"), "Strikethrough", <Strikethrough size={14} />, () =>
        editor.chain().focus().toggleStrike().run(),
      )}
      {btn(editor.isActive("code"), "Inline code", <Code size={14} />, () =>
        editor.chain().focus().toggleCode().run(),
      )}
      {btn(
        editor.isActive("heading", { level: 1 }),
        "Heading 1",
        <Heading1 size={14} />,
        () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {btn(
        editor.isActive("heading", { level: 2 }),
        "Heading 2",
        <Heading2 size={14} />,
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {btn(editor.isActive("bulletList"), "Bullet list", <List size={14} />, () =>
        editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(
        editor.isActive("orderedList"),
        "Ordered list",
        <ListOrdered size={14} />,
        () => editor.chain().focus().toggleOrderedList().run(),
      )}
      {btn(editor.isActive("blockquote"), "Blockquote", <Quote size={14} />, () =>
        editor.chain().focus().toggleBlockquote().run(),
      )}
    </>
  );
}
