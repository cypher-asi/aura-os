import { useState } from "react";
import { FileText } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import { useHighlightedHtml } from "../../hooks/use-highlighted-html";
import fileStyles from "../FilePreviewCard/FilePreviewCard.module.css";
import toolStyles from "../ToolCallBlock.module.css";

const COLLAPSED_SPEC_LINES = 20;

export function SpecPreviewCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const title = (entry.input.title as string) || "Untitled spec";
  const content = (entry.input.markdown_contents as string) || "";
  const lines = content.split("\n");
  const needsCollapse = lines.length > COLLAPSED_SPEC_LINES;
  const displayContent =
    !expanded && needsCollapse
      ? lines.slice(0, COLLAPSED_SPEC_LINES).join("\n")
      : content;

  const highlightedHtml = useHighlightedHtml(displayContent, "markdown");

  return (
    <div className={fileStyles.card}>
      <div className={fileStyles.header}>
        <FileText size={14} className={fileStyles.fileIcon} />
        <span className={fileStyles.fileName}>{title}</span>
        <span className={fileStyles.badge}>Spec</span>
      </div>
      <div className={`${fileStyles.codeArea} ${!expanded && needsCollapse ? fileStyles.collapsed : ""}`}>
        <pre>
          <code
            className="hljs language-markdown"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
      {needsCollapse && (
        <button
          type="button"
          className={fileStyles.toggleBtn}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
      {entry.isError && entry.result && (
        <div className={toolStyles.inlineError}>
          {entry.result.slice(0, 200)}
        </div>
      )}
    </div>
  );
}
