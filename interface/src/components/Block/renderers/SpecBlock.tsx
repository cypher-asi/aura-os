import { FileText } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { useHighlightedHtml } from "../../../hooks/use-highlighted-html";
import { specFilename } from "../../../utils/format";
import { CopyButton } from "../../CopyButton";
import { Block } from "../Block";
import blockStyles from "../Block.module.css";
import styles from "./renderers.module.css";

interface SpecBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function SpecBlock({ entry, defaultExpanded }: SpecBlockProps) {
  const title = (entry.input.title as string) || "";
  const filename = specFilename(title);
  const toolContent = (entry.input.markdown_contents as string) || "";
  const draftPreview = (entry.input.draft_preview as string) || "";
  const content = toolContent || draftPreview;
  const highlightedHtml = useHighlightedHtml(content, "markdown");

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";
  const showCopyToolbar = content.length > 0 && !entry.pending;

  return (
    <Block
      icon={<FileText size={12} />}
      title={filename}
      badge={entry.name === "update_spec" ? "Update" : "Spec"}
      status={status}
      defaultExpanded={defaultExpanded || entry.pending}
      forceExpanded={entry.pending}
      autoScroll={entry.pending}
      flushBody
    >
      {showCopyToolbar ? (
        <div className={styles.blockBodyToolbar}>
          <CopyButton getText={() => content} ariaLabel={`Copy ${filename}`} />
        </div>
      ) : null}
      <div className={styles.codeArea}>
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
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : null}
    </Block>
  );
}
