import { useEffect, useRef } from "react";
import { FileText } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import { useHighlightedHtml } from "../../hooks/use-highlighted-html";
import { specFilename } from "../../utils/format";
import fileStyles from "../FilePreviewCard/FilePreviewCard.module.css";
import toolStyles from "./ToolCallBlock.module.css";

export function SpecPreviewCard({ entry }: { entry: ToolCallEntry }) {
  const title = (entry.input.title as string) || "";
  const filename = specFilename(title);
  const content = (entry.input.markdown_contents as string) || "";
  const highlightedHtml = useHighlightedHtml(content, "markdown");
  const showSpinner = !content.trim() && entry.pending;

  const codeAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!entry.pending) return;
    const el = codeAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [highlightedHtml, entry.pending]);

  return (
    <div className={`${fileStyles.card} ${fileStyles.specCard}`}>
      <div className={`${fileStyles.header} ${fileStyles.specHeader}`}>
        <FileText size={14} className={fileStyles.fileIcon} />
        <span className={fileStyles.fileName} title={title || filename}>
          {filename}
        </span>
      </div>
      {content.trim() ? (
        <div
          ref={codeAreaRef}
          className={`${fileStyles.codeArea} ${fileStyles.specCodeArea} ${fileStyles.specCodeAreaFixed}`}
        >
          <pre>
            <code
              className="hljs language-markdown"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        </div>
      ) : showSpinner ? (
        <div className={`${fileStyles.codeArea} ${fileStyles.specCodeArea} ${fileStyles.specCodeAreaFixed} ${fileStyles.pendingCodeArea}`}>
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
