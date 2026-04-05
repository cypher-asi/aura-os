import type { ActivityItem } from "./derive-activity";

export function deriveLegacyJsonActivity(buffer: string): ActivityItem[] {
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

function parseFileOpPhase(
  buf: string,
  objStart: number,
  objEnd: number,
): { phase: DetectedFileOp["phase"]; contentLength: number } {
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
  return { phase, contentLength };
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
    if (!op && !path) { i = objStart + 1; continue; }

    const objEnd = findObjectEnd(buf, objStart);
    const { phase, contentLength } = parseFileOpPhase(buf, objStart, objEnd);

    ops.push({ op: op ?? "unknown", path: path ?? "unknown", phase, contentLength });
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
