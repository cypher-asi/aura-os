import { useState } from "react";
import { FileCode, FileText, FileX } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import { langFromPath } from "../../ide/lang";
import { useHighlightedHtml } from "../../hooks/use-highlighted-html";
import styles from "./FilePreviewCard.module.css";

const COLLAPSED_LINE_LIMIT = 20;

interface FilePreviewCardProps {
  entry: ToolCallEntry;
}

function DiffView({ oldText, newText, language }: { oldText: string; newText: string; language?: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldHighlighted = useHighlightedHtml(oldText, language);
  const newHighlighted = useHighlightedHtml(newText, language);
  const oldHtmlLines = oldHighlighted.split("\n");
  const newHtmlLines = newHighlighted.split("\n");

  return (
    <div className={styles.diffArea}>
      {oldLines.map((_line, i) => (
        <div key={`old-${i}`} className={`${styles.diffLine} ${styles.diffRemoved}`}>
          <span className={styles.lineNum}>{i + 1}</span>
          <span className={styles.diffPrefix}>-</span>
          <span
            className={styles.diffContent}
            dangerouslySetInnerHTML={{ __html: oldHtmlLines[i] ?? "" }}
          />
        </div>
      ))}
      {newLines.map((_line, i) => (
        <div key={`new-${i}`} className={`${styles.diffLine} ${styles.diffAdded}`}>
          <span className={styles.lineNum}>{i + 1}</span>
          <span className={styles.diffPrefix}>+</span>
          <span
            className={styles.diffContent}
            dangerouslySetInnerHTML={{ __html: newHtmlLines[i] ?? "" }}
          />
        </div>
      ))}
    </div>
  );
}

function CodeView({ content, language }: { content: string; language?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const needsCollapse = lines.length > COLLAPSED_LINE_LIMIT;
  const displayContent = !expanded && needsCollapse
    ? lines.slice(0, COLLAPSED_LINE_LIMIT).join("\n")
    : content;

  const highlightedHtml = useHighlightedHtml(displayContent, language);
  const htmlLines = highlightedHtml.split("\n");
  const displayLines = displayContent.split("\n");

  return (
    <>
      <div className={`${styles.codeArea} ${!expanded && needsCollapse ? styles.collapsed : ""}`}>
        <div className={styles.codeLines}>
          {displayLines.map((_line, i) => (
            <div key={i} className={styles.codeLine}>
              <span className={styles.lineNum}>{i + 1}</span>
              <span
                className={styles.codeContent}
                dangerouslySetInnerHTML={{ __html: htmlLines[i] ?? "" }}
              />
            </div>
          ))}
        </div>
      </div>
      {needsCollapse && (
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </>
  );
}

function PendingSpinner() {
  return (
    <div className={`${styles.codeArea} ${styles.pendingCodeArea}`}>
      <div className={styles.pendingOverlay}>
        <div className={styles.spinner} />
      </div>
    </div>
  );
}

export function FilePreviewCard({ entry }: FilePreviewCardProps) {
  const path = (entry.input.path as string) || "";
  const lang = langFromPath(path);
  const fileName = path.split(/[/\\]/).pop() || path;

  const isEdit = entry.name === "edit_file";
  const isWrite = entry.name === "write_file";
  const isRead = entry.name === "read_file";
  const isDelete = entry.name === "delete_file";

  const badgeLabel = isEdit
    ? "Edit"
    : isWrite
      ? "Write"
      : isDelete
        ? "Delete"
        : "Read";
  const Icon = isDelete ? FileX : isEdit || isWrite ? FileCode : FileText;

  const oldText = (entry.input.old_text as string) || "";
  const newText = (entry.input.new_text as string) || "";
  const writeContent = (entry.input.content as string) || "";

  const renderBody = () => {
    if (isDelete) {
      return null;
    }
    if (isEdit) {
      if (!oldText && !newText && entry.pending) return <PendingSpinner />;
      return <DiffView oldText={oldText} newText={newText} language={lang} />;
    }
    if (isWrite) {
      if (!writeContent && entry.pending) return <PendingSpinner />;
      return <CodeView content={writeContent} language={lang} />;
    }
    if (isRead) {
      if (entry.result) return <CodeView content={entry.result} language={lang} />;
      if (entry.pending) return <PendingSpinner />;
      return null;
    }
    return null;
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Icon size={14} className={styles.fileIcon} />
        <span className={styles.fileName} title={path}>{fileName || "…"}</span>
        <span className={styles.badge}>{badgeLabel}</span>
      </div>
      {renderBody()}
    </div>
  );
}
