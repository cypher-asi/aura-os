import { FileCode, FileText, FileX } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../../types/stream";
import { langFromPath } from "../../../ide/lang";
import { useHighlightedHtml } from "../../../hooks/use-highlighted-html";
import { TOOL_PHASE_LABELS } from "../../../constants/tools";
import { decodeCapturedOutput } from "../../../utils/format";
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
  const hasPath = path.length > 0;

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

  // While a write/edit is still streaming and the path has not arrived yet,
  // fall back to the tool's phase label ("Writing code...") instead of a bare
  // ellipsis so the row reads as a live action rather than malformed UI.
  const fallbackTitle = entry.pending
    ? (TOOL_PHASE_LABELS[entry.name] ?? "Working...")
    : "Untitled file";
  const fileName = hasPath
    ? (path.split(/[/\\]/).pop() || path)
    : fallbackTitle;

  const hasEditContent = oldText.length > 0 || newText.length > 0;
  const hasWriteContent = writeContent.length > 0;
  const hasReadContent = !!entry.result;

  let body: ReactNode = null;
  if (isDelete) {
    body = null;
  } else if (isEdit && hasEditContent) {
    body = (
      <DiffView
        oldText={oldText}
        newText={newText}
        language={lang}
        streaming={entry.pending}
      />
    );
  } else if (isWrite && hasWriteContent) {
    body = <CodeView content={writeContent} language={lang} streaming={entry.pending} />;
  } else if (isRead && hasReadContent) {
    // `read_file` results arrive as a JSON envelope
    // `{ ok, stdout: <base64 file contents>, stderr, metadata }`. Decode it
    // so the viewer shows the actual file content (syntax-highlighted by
    // path) rather than a one-line JSON blob with raw base64 inside.
    const decoded = decodeCapturedOutput(entry.result as string);
    if (decoded.ok === false) {
      body = (
        <div className={styles.inlineError}>
          {decoded.stderr || decoded.stdout || "Read failed."}
        </div>
      );
    } else {
      body = <CodeView content={decoded.stdout} language={lang} />;
    }
  }

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";
  // Only force the preview open while content is actually streaming in; an
  // empty seed should collapse to a compact header so we never render an empty
  // code surface with just a "1" line number.
  const forcePreview =
    entry.pending && ((isWrite && hasWriteContent) || (isEdit && hasEditContent));

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
