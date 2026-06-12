import { useCallback, useRef } from "react";
import { FileText } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { useHighlightedHtml } from "../../../shared/hooks/use-highlighted-html";
import { useMarkdownCopy } from "../../../shared/hooks/use-markdown-copy";
import { specFilename } from "../../../shared/utils/format";
import { TOOL_LABELS } from "../../../constants/tools";
import {
  blockStatusForSeverity,
  deriveToolSeverity,
} from "../../../utils/tool-severity";
import { Block } from "../Block";
import blockStyles from "../Block.module.css";
import styles from "./renderers.module.css";

interface SpecBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function SpecBlock({ entry, defaultExpanded }: SpecBlockProps) {
  const specTitle = (entry.input.title as string) || "";
  const filename = specFilename(specTitle);
  const toolContent = (entry.input.markdown_contents as string) || "";
  const draftPreview = (entry.input.draft_preview as string) || "";
  const content = toolContent || draftPreview;
  const highlightedHtml = useHighlightedHtml(content, "markdown");

  const severity = deriveToolSeverity(entry);
  const status = blockStatusForSeverity(severity);
  const toolLabel = TOOL_LABELS[entry.name] ?? "Spec";

  // Select+copy of the whole spec body should yield the *original*
  // markdown source rather than the highlighted-HTML rendering --
  // otherwise pasting into Obsidian gets a soup of `<span class="hljs-...">`
  // text with broken indentation. Partial selections fall through to
  // the browser default.
  const codeAreaRef = useRef<HTMLDivElement>(null);
  const getMarkdown = useCallback(() => content, [content]);
  useMarkdownCopy(codeAreaRef, getMarkdown);

  return (
    <Block
      icon={<FileText size={12} />}
      title={toolLabel}
      summary={filename || undefined}
      status={status}
      defaultExpanded={defaultExpanded || entry.pending}
      forceExpanded={entry.pending}
      autoScroll={entry.pending}
      flushBody
      copy={{
        getMarkdown: content ? () => content : undefined,
        getText: content ? undefined : () => filename || toolLabel,
        ariaLabel: `Copy ${filename || toolLabel}`,
      }}
    >
      <div ref={codeAreaRef} className={styles.codeArea}>
        <pre>
          <code
            className="hljs language-markdown"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
          {entry.pending && (
            <span className={blockStyles.streamCaret} aria-hidden="true" />
          )}
        </pre>
      </div>
      {entry.isError && entry.result ? (
        <div className={severity === "error" ? styles.inlineError : styles.inlineNote}>
          {String(entry.result).slice(0, 240)}
        </div>
      ) : null}
    </Block>
  );
}
