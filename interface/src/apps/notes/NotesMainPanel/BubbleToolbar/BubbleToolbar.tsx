import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import styles from "./BubbleToolbar.module.css";

export interface BubbleToolbarProps {
  editor: Editor | null;
}

interface ToolbarAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly isActive: (editor: Editor) => boolean;
  readonly run: (editor: Editor) => void;
}

const ACTIONS: readonly ToolbarAction[] = [
  {
    label: "Bold",
    icon: <Bold size={14} />,
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: "Italic",
    icon: <Italic size={14} />,
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: "Strikethrough",
    icon: <Strikethrough size={14} />,
    isActive: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    label: "Inline code",
    icon: <Code size={14} />,
    isActive: (e) => e.isActive("code"),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    label: "Heading 1",
    icon: <Heading1 size={14} />,
    isActive: (e) => e.isActive("heading", { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    icon: <Heading2 size={14} />,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Bullet list",
    icon: <List size={14} />,
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Ordered list",
    icon: <ListOrdered size={14} />,
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Blockquote",
    icon: <Quote size={14} />,
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

export function BubbleToolbar({ editor }: BubbleToolbarProps) {
  if (!editor) return null;
  return (
    <>
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          className={styles.bubbleButton}
          data-active={action.isActive(editor)}
          // Using mouseDown (not click) avoids the editor losing its
          // selection the moment the user clicks a toolbar button.
          onMouseDown={(e) => {
            e.preventDefault();
            action.run(editor);
          }}
          aria-label={action.label}
          title={action.label}
        >
          {action.icon}
        </button>
      ))}
    </>
  );
}
