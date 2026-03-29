import { useState, useMemo } from "react";
import { FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import styles from "./LargeTextBlock.module.css";

const CHAR_THRESHOLD = 600;
const LINE_THRESHOLD = 15;

const MD_REMARK = [remarkGfm];
const MD_REHYPE = [rehypeHighlight];

const HEADING_RE = /^#{1,3}\s+(.+)/m;

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

export function LargeTextBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const title = useMemo(() => extractTitle(text), [text]);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <FileText size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>{title}</span>
        <span className={styles.badge}>Doc</span>
      </div>

      <div
        className={`${styles.contentArea} ${expanded ? styles.expanded : styles.collapsed}`}
      >
        <ReactMarkdown remarkPlugins={MD_REMARK} rehypePlugins={MD_REHYPE}>
          {text}
        </ReactMarkdown>
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
