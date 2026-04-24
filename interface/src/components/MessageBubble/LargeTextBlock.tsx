import { useState, useMemo } from "react";
import { FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyButton } from "../CopyButton";
import styles from "./LargeTextBlock.module.css";

const CHAR_THRESHOLD = 600;
const LINE_THRESHOLD = 15;

const MD_REMARK = [remarkGfm];
const MD_REHYPE = [rehypeHighlight];

function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

const MD_COMPONENTS = { a: ExternalLink };

const HEADING_RE = /^#{1,3}\s+(.+)/m;
const PREVIEW_CHAR_LIMIT = 900;

export function isLargeText(text: string): boolean {
  if (text.length > CHAR_THRESHOLD) return true;
  let count = 0;
  let idx = -1;
  while ((idx = text.indexOf("\n", idx + 1)) !== -1) {
    if (++count >= LINE_THRESHOLD) return true;
  }
  return false;
}

function extractTitle(text: string): string {
  const match = text.match(HEADING_RE);
  if (match) return match[1].trim();
  const firstLine = text.slice(0, 120).split("\n")[0].trim();
  return firstLine || "Document";
}

function buildPreview(text: string): string {
  const collapsed = text.slice(0, PREVIEW_CHAR_LIMIT).trimEnd();
  if (collapsed.length >= text.length) {
    return collapsed;
  }
  return `${collapsed}\n\n...`;
}

export function LargeTextBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const title = useMemo(() => extractTitle(text), [text]);
  const preview = useMemo(() => buildPreview(text), [text]);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <FileText size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>{title}</span>
        <CopyButton getText={() => text} className={styles.headerCopy} />
        <span className={styles.badge}>Doc</span>
      </div>

      <div
        className={`${styles.contentArea} ${expanded ? styles.expanded : styles.collapsed}`}
      >
        {expanded ? (
          <ReactMarkdown
            remarkPlugins={MD_REMARK}
            rehypePlugins={MD_REHYPE}
            components={MD_COMPONENTS}
          >
            {text}
          </ReactMarkdown>
        ) : (
          <pre className={styles.previewText}>{preview}</pre>
        )}
        {!expanded && <div className={styles.fade} />}
      </div>

      <button
        type="button"
        className={styles.toggleBtn}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
