import { useMemo } from "react";
import { FileText, CheckCircle2, XCircle, Search, Terminal, Trash2, FolderOpen, Wrench } from "lucide-react";
import { useMarkdownHtml } from "../../utils/markdown";
import styles from "./SegmentedContent.module.css";

type ContentSegment =
  | { key: string; kind: "text"; content: string }
  | { key: string; kind: "tool"; name: string; arg?: string; status: "ok" | "error" }
  | { key: string; kind: "auto-build"; command: string };

const INLINE_MARKER_RE =
  /\[tool:\s*(\S+?)(?:\(([^)]*)\))?\s*(?:->|→)\s*(ok|error)\]|\[auto-build:\s*([^\]]+)\]/g;

function splitContentByMarkers(text: string): ContentSegment[] | null {
  INLINE_MARKER_RE.lastIndex = 0;
  const first = INLINE_MARKER_RE.exec(text);
  if (!first) return null;

  INLINE_MARKER_RE.lastIndex = 0;
  const segments: ContentSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_MARKER_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      const prose = text.slice(cursor, match.index).trim();
      if (prose) segments.push({ key: `text-${cursor}`, kind: "text", content: prose });
    }
    if (match[4] !== undefined) {
      segments.push({ key: `auto-build-${match.index}`, kind: "auto-build", command: match[4].trim() });
    } else {
      segments.push({
        key: `tool-${match.index}-${match[1]}-${match[3]}`,
        kind: "tool",
        name: match[1],
        arg: match[2] || undefined,
        status: match[3] as "ok" | "error",
      });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    const prose = text.slice(cursor).trim();
    if (prose) segments.push({ key: `text-${cursor}`, kind: "text", content: prose });
  }

  return segments.length > 0 ? segments : null;
}

function inlineToolIcon(name: string) {
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

function shortenArg(arg: string, max: number): string {
  return arg.length <= max ? arg : arg.slice(0, max - 1) + "\u2026";
}

function inlineToolLabel(name: string, arg?: string): string {
  const short = arg ? shortenArg(arg, 60) : "";
  switch (name) {
    case "read_file": return short ? `Read \`${short}\`` : "Read file";
    case "write_file": return short ? `Write \`${short}\`` : "Write file";
    case "edit_file": return short ? `Edit \`${short}\`` : "Edit file";
    case "delete_file": return short ? `Delete \`${short}\`` : "Delete file";
    case "list_files": return short ? `List \`${short}\`` : "List files";
    case "search_code": return short ? `Search: ${short}` : "Search code";
    case "run_command": return short ? `Run: \`${short}\`` : "Run command";
    default: return short ? `${name}: ${short}` : `Tool: ${name}`;
  }
}

function InlineToolMarker({ seg }: { seg: Extract<ContentSegment, { kind: "tool" }> }) {
  const isError = seg.status === "error";
  return (
    <div className={styles.inlineToolMarker} data-status={seg.status}>
      <span className={styles.inlineToolIcon}>{inlineToolIcon(seg.name)}</span>
      <span className={styles.inlineToolLabel}>{inlineToolLabel(seg.name, seg.arg)}</span>
      <span className={`${styles.inlineToolStatus} ${isError ? styles.inlineToolError : styles.inlineToolOk}`}>
        {isError ? <XCircle size={10} /> : <CheckCircle2 size={10} />}
        {seg.status}
      </span>
    </div>
  );
}

function InlineAutoBuildMarker({ seg }: { seg: Extract<ContentSegment, { kind: "auto-build" }> }) {
  return (
    <div className={styles.inlineToolMarker} data-status="build">
      <span className={styles.inlineToolIcon}><Terminal size={12} /></span>
      <span className={styles.inlineToolLabel}>Build: <code>{seg.command}</code></span>
    </div>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  const html = useMarkdownHtml(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SegmentedContent({ content }: { content: string }) {
  const segments = useMemo(() => splitContentByMarkers(content), [content]);

  if (!segments) {
    return <MarkdownBlock content={content} />;
  }

  return (
    <>
      {segments.map((seg) => {
        if (seg.kind === "text") {
          return <MarkdownBlock key={seg.key} content={seg.content} />;
        }
        if (seg.kind === "auto-build") {
          return <InlineAutoBuildMarker key={seg.key} seg={seg} />;
        }
        return <InlineToolMarker key={seg.key} seg={seg} />;
      })}
    </>
  );
}
