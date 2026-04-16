import { useState } from "react";
import { FileText } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import { useHighlightedHtml } from "../../hooks/use-highlighted-html";
import { specFilename } from "../../utils/format";
import fileStyles from "../FilePreviewCard/FilePreviewCard.module.css";
import toolStyles from "./ToolCallBlock.module.css";

const COLLAPSED_SPEC_LINES = 20;

export function SpecPreviewCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const title = (entry.input.title as string) || "";
  const filename = specFilename(title);
  const content = (entry.input.markdown_contents as string) || "";
  const lines = content.split("\n");
  const needsCollapse = lines.length > COLLAPSED_SPEC_LINES;
  const displayContent =
    !expanded && needsCollapse
      ? lines.slice(0, COLLAPSED_SPEC_LINES).join("\n")
      : content;

  const highlightedHtml = useHighlightedHtml(displayContent, "markdown");
  const showSpinner = !content.trim() && entry.pending;

  return (
    <div className={`${fileStyles.card} ${fileStyles.specCard}`}>
      <div className={`${fileStyles.header} ${fileStyles.specHeader}`}>
        <FileText size={14} className={fileStyles.fileIcon} />
        <span className={fileStyles.fileName} title={title || filename}>
          {filename}
        </span>
      </div>
      {content.trim() ? (
        <>
          <div
            className={`${fileStyles.codeArea} ${fileStyles.specCodeArea} ${!expanded && needsCollapse ? fileStyles.collapsed : ""}`}
          >
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
              className={`${fileStyles.toggleBtn} ${fileStyles.specToggleBtn}`}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show less" : `Show all ${lines.length} lines`}
            </button>
          )}
        </>
      ) : showSpinner ? (
        <div className={`${fileStyles.codeArea} ${fileStyles.specCodeArea} ${fileStyles.pendingCodeArea}`}>
          <div className={fileStyles.pendingOverlay}>
            <div className={fileStyles.spinner} />
          </div>
        </div>
      ) : null}
      {entry.isError && entry.result && (
        <div className={toolStyles.inlineError}>
          {entry.result.slice(0, 200)}
        </div>
      )}
    </div>
  );
}
