import { useState } from "react";
import { FileCode, FileText } from "lucide-react";
import type { ToolCallEntry } from "../types/stream";
import styles from "./FilePreviewCard.module.css";

const LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  rs: "rust", py: "python", go: "go", rb: "ruby", java: "java",
  css: "css", html: "xml", json: "json", yaml: "yaml", yml: "yaml",
  md: "markdown", sql: "sql", sh: "bash", toml: "ini",
};

function langFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? LANG_MAP[ext] : undefined;
}

const COLLAPSED_LINE_LIMIT = 20;

interface FilePreviewCardProps {
  entry: ToolCallEntry;
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  return (
    <div className={styles.diffArea}>
      {oldLines.map((line, i) => (
        <div key={`old-${i}`} className={`${styles.diffLine} ${styles.diffRemoved}`}>
          - {line}
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`new-${i}`} className={`${styles.diffLine} ${styles.diffAdded}`}>
          + {line}
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

  return (
    <>
      <div className={`${styles.codeArea} ${!expanded && needsCollapse ? styles.collapsed : ""}`}>
        <pre>
          <code className={language ? `hljs language-${language}` : undefined}>
            {displayContent}
          </code>
        </pre>
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

export function FilePreviewCard({ entry }: FilePreviewCardProps) {
  const path = (entry.input.path as string) || "";
  const lang = langFromPath(path);
  const fileName = path.split(/[/\\]/).pop() || path;

  const isEdit = entry.name === "edit_file";
  const isWrite = entry.name === "write_file";
  const isRead = entry.name === "read_file";

  const badgeLabel = isEdit ? "Edit" : isWrite ? "Write" : "Read";
  const Icon = isEdit || isWrite ? FileCode : FileText;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Icon size={14} className={styles.fileIcon} />
        <span className={styles.fileName} title={path}>{fileName}</span>
        <span className={styles.badge}>{badgeLabel}</span>
      </div>
      {isEdit ? (
        <DiffView
          oldText={(entry.input.old_text as string) || ""}
          newText={(entry.input.new_text as string) || ""}
        />
      ) : isWrite ? (
        <CodeView content={(entry.input.content as string) || ""} language={lang} />
      ) : isRead && entry.result ? (
        <CodeView content={entry.result} language={lang} />
      ) : (
        !entry.pending ? null : (
          <div className={styles.codeArea} style={{ minHeight: 40, position: "relative" }}>
            <div className={styles.pendingOverlay}>
              <div className={styles.spinner} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
