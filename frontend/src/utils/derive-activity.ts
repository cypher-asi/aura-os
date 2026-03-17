export interface ActivityItem {
  id: string;
  message: string;
  detail?: string;
  status: "active" | "done";
}

/**
 * Scans a task output buffer and derives a human-readable activity list.
 *
 * Supports two formats:
 * 1. Legacy single-shot JSON: {"notes":"...","file_ops":[...],"follow_up_tasks":[...]}
 * 2. Agentic tool-use: plain LLM text interspersed with [tool: <name> -> ok|error] markers
 */
export function deriveActivity(buffer: string): ActivityItem[] {
  if (!buffer) {
    return [{ id: "thinking", message: "Generating response", status: "active" }];
  }

  if (isAgenticFormat(buffer)) {
    return deriveAgenticActivity(buffer);
  }

  return deriveLegacyJsonActivity(buffer);
}

const TOOL_MARKER_RE = /\[tool:\s*(\S+?)(?:\(([^)]*)\))?\s*->\s*(ok|error)\]/g;
const TOOL_MARKER_TEST = /\[tool:\s*\S+?(?:\([^)]*\))?\s*->\s*(?:ok|error)\]/;

function isAgenticFormat(buffer: string): boolean {
  return TOOL_MARKER_TEST.test(buffer) || !buffer.trimStart().startsWith("{");
}

function deriveAgenticActivity(buffer: string): ActivityItem[] {
  const items: ActivityItem[] = [];
  TOOL_MARKER_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = TOOL_MARKER_RE.exec(buffer)) !== null) {
    const toolName = match[1];
    const toolArg = match[2] || undefined;
    const result = match[3];
    const msg = agenticToolLabel(toolName, toolArg);
    const detail = result === "error" ? "(failed)" : undefined;
    items.push({ id: `tool-${idx}`, message: msg, detail, status: "done" });
    idx++;
  }

  const lastMarkerEnd = findLastToolMarkerEnd(buffer);
  const trailing = lastMarkerEnd === -1 ? buffer : buffer.slice(lastMarkerEnd);
  const trailingText = trailing.trim();

  if (trailingText.length > 0) {
    const label = summarizeTrailingText(trailingText);
    items.push({ id: "current", message: label, status: "active" });
  } else if (items.length === 0) {
    items.push({ id: "thinking", message: "Generating response", status: "active" });
  }

  return items;
}

function findLastToolMarkerEnd(buffer: string): number {
  TOOL_MARKER_RE.lastIndex = 0;
  let lastEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = TOOL_MARKER_RE.exec(buffer)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  return lastEnd;
}

function agenticToolLabel(toolName: string, arg?: string): string {
  const shortArg = arg ? shortenArg(arg, 60) : "";
  switch (toolName) {
    case "read_file": return shortArg ? `Read \`${shortArg}\`` : "Read file";
    case "write_file": return shortArg ? `Write \`${shortArg}\`` : "Write file";
    case "edit_file": return shortArg ? `Edit \`${shortArg}\`` : "Edit file";
    case "delete_file": return shortArg ? `Delete \`${shortArg}\`` : "Delete file";
    case "list_files": return shortArg ? `List \`${shortArg}\`` : "List files";
    case "search_code": return shortArg ? `Search: ${shortArg}` : "Search code";
    case "run_command": return shortArg ? `Run: \`${shortArg}\`` : "Run command";
    case "task_done": return "Task complete";
    case "get_task_context": return "Load task context";
    default: return shortArg ? `${toolName}: ${shortArg}` : `Tool: ${toolName}`;
  }
}

function shortenArg(arg: string, max: number): string {
  if (arg.length <= max) return arg;
  return arg.slice(0, max - 1) + "\u2026";
}

function summarizeTrailingText(text: string): string {
  const firstLine = extractFirstMeaningfulLine(text);
  if (firstLine) return firstLine;
  return "Generating response";
}

const MAX_SUMMARY_LEN = 100;

function extractFirstMeaningfulLine(text: string): string | null {
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length < 4) continue;
    if (/^[\s\-*#`>|=]+$/.test(line)) continue;

    let cleaned = line
      .replace(/^#+\s*/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/^>\s+/, "")
      .trim();

    if (!cleaned) continue;

    if (cleaned.length > MAX_SUMMARY_LEN) {
      const cutoff = cleaned.lastIndexOf(" ", MAX_SUMMARY_LEN);
      cleaned = cleaned.slice(0, cutoff > 40 ? cutoff : MAX_SUMMARY_LEN) + "\u2026";
    }
    return cleaned;
  }
  return null;
}

function deriveLegacyJsonActivity(buffer: string): ActivityItem[] {
  const items: ActivityItem[] = [];
  if (!buffer.includes("{")) {
    items.push({ id: "thinking", message: "Generating response", status: "active" });
    return items;
  }

  const notesPhase = detectNotesPhase(buffer);
  const fileOps = detectFileOps(buffer);
  const followUpPhase = detectFollowUpPhase(buffer);

  if (notesPhase === "writing") {
    items.push({ id: "notes", message: "Writing implementation notes", status: "active" });
  } else if (notesPhase === "done") {
    items.push({ id: "notes", message: "Writing implementation notes", status: "done" });
  }

  for (let i = 0; i < fileOps.length; i++) {
    const fop = fileOps[i];
    const verb = opVerb(fop.op);
    const msg = `${verb} ${fop.path}`;
    const isLast = i === fileOps.length - 1;
    const status = isLast && fop.phase !== "done" ? "active" : "done";
    const detail =
      status === "active" && fop.phase === "content"
        ? formatContentProgress(fop.contentLength)
        : undefined;
    items.push({ id: `file-${i}`, message: msg, detail, status });
  }

  if (followUpPhase === "writing") {
    items.push({ id: "followup", message: "Identifying follow-up tasks", status: "active" });
  } else if (followUpPhase === "done") {
    items.push({ id: "followup", message: "Identifying follow-up tasks", status: "done" });
  }

  if (items.length === 0) {
    items.push({ id: "thinking", message: "Generating response", status: "active" });
  }

  return items;
}

type Phase = "none" | "writing" | "done";

interface DetectedFileOp {
  op: string;
  path: string;
  phase: "header" | "content" | "done";
  contentLength: number;
}

function detectNotesPhase(buf: string): Phase {
  const marker = `"notes"`;
  const idx = buf.indexOf(marker);
  if (idx === -1) return "none";

  let i = idx + marker.length;
  while (i < buf.length && buf[i] !== ":") i++;
  i++;
  while (i < buf.length && isWhitespace(buf[i])) i++;
  if (i >= buf.length || buf[i] !== '"') return "writing";

  const end = findStringEnd(buf, i);
  if (end === -1) return "writing";
  return "done";
}

function detectFileOps(buf: string): DetectedFileOp[] {
  const ops: DetectedFileOp[] = [];
  const marker = `"file_ops"`;
  const arrStart = buf.indexOf(marker);
  if (arrStart === -1) return ops;

  let i = arrStart + marker.length;
  while (i < buf.length && buf[i] !== "[") i++;
  if (i >= buf.length) return ops;
  i++;

  while (i < buf.length) {
    const objStart = buf.indexOf("{", i);
    if (objStart === -1) break;

    const op = extractFieldStr(buf, objStart, "op");
    const path = extractFieldStr(buf, objStart, "path");

    if (!op && !path) {
      i = objStart + 1;
      continue;
    }

    const objEnd = findObjectEnd(buf, objStart);
    const contentIdx = buf.indexOf(`"content"`, objStart);
    const hasContentField = contentIdx !== -1 && (objEnd === -1 || contentIdx < objEnd);

    let phase: DetectedFileOp["phase"] = "header";
    let contentLength = 0;

    if (hasContentField) {
      const contentValStart = findValueStart(buf, contentIdx + `"content"`.length);
      if (contentValStart !== -1 && buf[contentValStart] === '"') {
        const contentEnd = findStringEnd(buf, contentValStart);
        if (contentEnd === -1) {
          phase = "content";
          contentLength = buf.length - contentValStart - 1;
        } else {
          phase = objEnd !== -1 ? "done" : "content";
          contentLength = contentEnd - contentValStart - 1;
        }
      } else {
        phase = "content";
      }
    }

    if (objEnd !== -1) phase = "done";

    ops.push({
      op: op ?? "unknown",
      path: path ?? "unknown",
      phase,
      contentLength,
    });

    if (objEnd === -1) break;
    i = objEnd + 1;
  }

  return ops;
}

function detectFollowUpPhase(buf: string): Phase {
  const marker = `"follow_up_tasks"`;
  const idx = buf.indexOf(marker);
  if (idx === -1) return "none";

  let i = idx + marker.length;
  while (i < buf.length && buf[i] !== "[") i++;
  if (i >= buf.length) return "writing";

  const arrEnd = findArrayEnd(buf, i);
  return arrEnd === -1 ? "writing" : "done";
}

function opVerb(op: string): string {
  switch (op) {
    case "create": return "Creating";
    case "modify": return "Modifying";
    case "delete": return "Deleting";
    default: return "Processing";
  }
}

function formatContentProgress(charCount: number): string {
  if (charCount < 500) return "writing content...";
  const approxLines = Math.round(charCount / 45);
  if (charCount >= 10_000) {
    const kb = (charCount / 1024).toFixed(1);
    return `writing content (~${approxLines} lines, ${kb} KB)...`;
  }
  return `writing content (~${approxLines} lines)...`;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function findValueStart(buf: string, afterColon: number): number {
  let i = afterColon;
  while (i < buf.length && buf[i] !== ":") i++;
  if (i >= buf.length) return -1;
  i++;
  while (i < buf.length && isWhitespace(buf[i])) i++;
  return i < buf.length ? i : -1;
}

/**
 * Find end of a JSON string starting at `start` (which should point to the
 * opening `"`). Returns the index of the closing `"`, or -1 if unterminated.
 */
function findStringEnd(buf: string, start: number): number {
  if (buf[start] !== '"') return -1;
  let i = start + 1;
  while (i < buf.length) {
    if (buf[i] === "\\") { i += 2; continue; }
    if (buf[i] === '"') return i;
    i++;
  }
  return -1;
}

function findObjectEnd(buf: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < buf.length; i++) {
    if (escape) { escape = false; continue; }
    const ch = buf[i];
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findArrayEnd(buf: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < buf.length; i++) {
    if (escape) { escape = false; continue; }
    const ch = buf[i];
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractFieldStr(buf: string, searchFrom: number, fieldName: string): string | null {
  const marker = `"${fieldName}"`;
  const idx = buf.indexOf(marker, searchFrom);
  if (idx === -1) return null;

  const contentIdx = buf.indexOf(`"content"`, searchFrom);
  if (fieldName !== "content" && contentIdx !== -1 && idx > contentIdx) return null;

  const valStart = findValueStart(buf, idx + marker.length);
  if (valStart === -1 || buf[valStart] !== '"') return null;

  let i = valStart + 1;
  const chars: string[] = [];
  while (i < buf.length) {
    if (buf[i] === "\\") {
      i++;
      if (i >= buf.length) break;
      chars.push(buf[i] === "n" ? "\n" : buf[i] === "t" ? "\t" : buf[i]);
    } else if (buf[i] === '"') {
      return chars.join("");
    } else {
      chars.push(buf[i]);
    }
    i++;
  }
  return chars.join("");
}
