import { FileCode, FileText, FileX } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../../types/stream";
import { langFromPath } from "../../../ide/lang";
import { useHighlightedHtml } from "../../../hooks/use-highlighted-html";
import { Block } from "../Block";
import blockStyles from "../Block.module.css";
import styles from "./renderers.module.css";

function DiffView({
  oldText,
  newText,
  language,
  streaming,
}: {
  oldText: string;
  newText: string;
  language?: string;
  streaming?: boolean;
}) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldHighlighted = useHighlightedHtml(oldText, language);
  const newHighlighted = useHighlightedHtml(newText, language);
  const oldHtmlLines = oldHighlighted.split("\n");
  const newHtmlLines = newHighlighted.split("\n");
  const hasAny = oldText.length > 0 || newText.length > 0;

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
      {newLines.map((_line, i) => {
        const isLast = i === newLines.length - 1;
        return (
          <div key={`new-${i}`} className={`${styles.diffLine} ${styles.diffAdded}`}>
            <span className={styles.lineNum}>{i + 1}</span>
            <span className={styles.diffPrefix}>+</span>
            <span
              className={styles.diffContent}
              dangerouslySetInnerHTML={{ __html: newHtmlLines[i] ?? "" }}
            />
            {streaming && isLast && hasAny && (
              <span className={blockStyles.streamCaret} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CodeView({
  content,
  language,
  streaming,
}: {
  content: string;
  language?: string;
  streaming?: boolean;
}) {
  const highlightedHtml = useHighlightedHtml(content, language);
  const htmlLines = highlightedHtml.split("\n");
  const displayLines = content.split("\n");

  return (
    <div className={styles.codeArea}>
      {displayLines.map((_line, i) => {
        const isLast = i === displayLines.length - 1;
        return (
          <div key={i} className={styles.codeLine}>
            <span className={styles.lineNum}>{i + 1}</span>
            <span
              className={styles.codeContent}
              dangerouslySetInnerHTML={{ __html: htmlLines[i] ?? "" }}
            />
            {streaming && isLast && (
              <span className={blockStyles.streamCaret} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface FileBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function FileBlock({ entry, defaultExpanded }: FileBlockProps) {
  const path = (entry.input.path as string) || "";
  const lang = langFromPath(path);
  const fileName = path.split(/[/\\]/).pop() || path || "…";

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

  let body: ReactNode = null;
  if (isDelete) {
    body = null;
  } else if (isEdit) {
    body = (
      <DiffView
        oldText={oldText}
        newText={newText}
        language={lang}
        streaming={entry.pending}
      />
    );
  } else if (isWrite) {
    body = <CodeView content={writeContent} language={lang} streaming={entry.pending} />;
  } else if (isRead) {
    body = entry.result ? <CodeView content={entry.result} language={lang} /> : null;
  }

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";
  const forcePreview = entry.pending && (isWrite || isEdit);

  return (
    <Block
      icon={<Icon size={12} />}
      title={fileName}
      badge={badgeLabel}
      status={status}
      defaultExpanded={defaultExpanded || forcePreview}
      forceExpanded={forcePreview}
      autoScroll={entry.pending}
      flushBody
    >
      {body}
      {entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : null}
    </Block>
  );
}
