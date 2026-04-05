import { useMemo, forwardRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { FileText, Search, Terminal, Trash2, FolderOpen, CheckCircle2, XCircle, Wrench } from "lucide-react";
import { agenticToolLabel } from "../../utils/derive-activity";
import styles from "./FormattedRawOutput.module.css";

type Segment =
  | { kind: "text"; content: string }
  | { kind: "tool"; name: string; arg?: string; status: "ok" | "error" };

const TOOL_MARKER_RE = /\[tool:\s*(\S+?)(?:\(([^)]*)\))?\s*->\s*(ok|error)\]/g;

function parseSegments(buffer: string): Segment[] {
  const segments: Segment[] = [];
  TOOL_MARKER_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = TOOL_MARKER_RE.exec(buffer)) !== null) {
    if (match.index > cursor) {
      const text = buffer.slice(cursor, match.index).trim();
      if (text) segments.push({ kind: "text", content: text });
    }
    segments.push({
      kind: "tool",
      name: match[1],
      arg: match[2] || undefined,
      status: match[3] as "ok" | "error",
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < buffer.length) {
    const text = buffer.slice(cursor).trim();
    if (text) segments.push({ kind: "text", content: text });
  }

  return segments;
}

function toolIcon(name: string) {
  const size = 12;
  switch (name) {
    case "read_file": return <FileText size={size} />;
    case "write_file":
    case "edit_file": return <FileText size={size} />;
    case "delete_file": return <Trash2 size={size} />;
    case "list_files": return <FolderOpen size={size} />;
    case "search_code": return <Search size={size} />;
    case "run_command": return <Terminal size={size} />;
    default: return <Wrench size={size} />;
  }
}

interface Props {
  buffer: string;
}

export const FormattedRawOutput = forwardRef<HTMLDivElement, Props>(
  function FormattedRawOutput({ buffer }, ref) {
    const segments = useMemo(() => parseSegments(buffer), [buffer]);

    const isLegacyJson = buffer.trimStart().startsWith("{") && segments.length <= 1;
    if (isLegacyJson) {
      return (
        <pre className={styles.rawOutput}>{buffer}</pre>
      );
    }

    return (
      <div ref={ref} className={styles.formattedRawOutput}>
        {segments.map((seg, i) => {
          if (seg.kind === "text") {
            return (
              <div key={i} className={styles.rawProse}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {seg.content}
                </ReactMarkdown>
              </div>
            );
          }
          const label = agenticToolLabel(seg.name, seg.arg);
          const isError = seg.status === "error";
          return (
            <div key={i} className={styles.toolMarkerRow} data-status={seg.status}>
              <span className={styles.toolMarkerIcon}>{toolIcon(seg.name)}</span>
              <span className={styles.toolMarkerLabel}>{label}</span>
              <span className={`${styles.toolMarkerStatus} ${isError ? styles.toolMarkerError : styles.toolMarkerOk}`}>
                {isError ? <XCircle size={10} /> : <CheckCircle2 size={10} />}
                {seg.status}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
);
