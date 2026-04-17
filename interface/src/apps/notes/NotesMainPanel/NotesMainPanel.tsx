import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
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
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useActiveNote,
  useActiveNoteKey,
  useNotesStore,
} from "../../../stores/notes-store";
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

export function NotesMainPanel() {
  const params = useParams<{ projectId: string; notePath: string }>();
  const note = useActiveNote();
  const activeKey = useActiveNoteKey();
  const selectNote = useNotesStore((s) => s.selectNote);
  const updateContent = useNotesStore((s) => s.updateContent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<EditMode>("wysiwyg");
  const lastSyncedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!params.projectId || !params.notePath) return;
    const decoded = decodeURIComponent(params.notePath);
    if (
      activeKey?.projectId !== params.projectId ||
      activeKey?.relPath !== decoded
    ) {
      selectNote(params.projectId, decoded);
    }
  }, [params.projectId, params.notePath, activeKey, selectNote]);

  const { frontmatter, body } = useMemo(() => {
    if (!note) return { frontmatter: "", body: "" };
    return parseMdFrontmatter(note.content);
  }, [note]);

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
        if (!activeKey) return;
        const md = (ed.storage as unknown as {
          markdown: { getMarkdown: () => string };
        }).markdown.getMarkdown();
        const joined = rejoinFrontmatter(frontmatter, md);
        updateContent(activeKey.projectId, activeKey.relPath, joined);
      },
      editorProps: {
        attributes: {
          class: styles.editor,
          spellcheck: "false",
        },
      },
    },
    [activeKey?.projectId, activeKey?.relPath],
  );

  useEffect(() => {
    if (!editor || !note || !activeKey) return;
    const key = `${activeKey.projectId}::${activeKey.relPath}`;
    if (lastSyncedKey.current === key) return;
    lastSyncedKey.current = key;
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
    return (
      <Lane flex>
        <div className={styles.container}>
          <EmptyState>Select a note from the left menu or create a new one.</EmptyState>
        </div>
      </Lane>
    );
  }

  return (
    <Lane flex>
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <span
            className={`${styles.saveState} ${note?.error ? styles.saveStateError : ""}`}
          >
            {saveState}
          </span>
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
            {!note ? (
              <EmptyState>Loading note…</EmptyState>
            ) : mode === "wysiwyg" && editor ? (
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
