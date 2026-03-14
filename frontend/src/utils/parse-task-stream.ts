export interface ParsedTaskStream {
  notes: string | null;
  fileOps: { op: string; path: string }[];
  isPartial: boolean;
}

const TOOL_MARKER_RE = /\[tool:\s*\S+\s*->\s*(?:ok|error)\]/;

/**
 * Extracts structured data from a partial/complete task output buffer.
 *
 * Supports two formats:
 * 1. Legacy single-shot JSON: {"notes":"...","file_ops":[...],...}
 * 2. Agentic tool-use: plain text with [tool: <name> -> ok|error] markers.
 *    In this mode, notes and file ops are delivered via separate engine events,
 *    so we return an empty result.
 */
export function parseTaskStream(buffer: string): ParsedTaskStream {
  const result: ParsedTaskStream = { notes: null, fileOps: [], isPartial: true };

  if (TOOL_MARKER_RE.test(buffer) || !buffer.trimStart().startsWith("{")) {
    return result;
  }

  if (!buffer.includes("{")) return result;

  try {
    const parsed = JSON.parse(buffer);
    result.notes = parsed.notes ?? null;
    result.isPartial = false;
    if (Array.isArray(parsed.file_ops)) {
      result.fileOps = parsed.file_ops.map((f: { op?: string; path?: string }) => ({
        op: f.op ?? "unknown",
        path: f.path ?? "",
      }));
    }
    return result;
  } catch {
    // Incomplete JSON — fall through to incremental extraction
  }

  result.notes = extractNotesValue(buffer);
  result.fileOps = extractFileOpSummaries(buffer);
  return result;
}

function extractNotesValue(buf: string): string | null {
  const marker = `"notes"`;
  const idx = buf.indexOf(marker);
  if (idx === -1) return null;

  let i = idx + marker.length;
  while (i < buf.length && buf[i] !== ":") i++;
  i++; // skip ':'
  while (i < buf.length && (buf[i] === " " || buf[i] === "\n" || buf[i] === "\r" || buf[i] === "\t")) i++;
  if (i >= buf.length || buf[i] !== '"') return null;

  return extractJsonString(buf, i);
}

function extractFileOpSummaries(buf: string): { op: string; path: string }[] {
  const ops: { op: string; path: string }[] = [];
  const marker = `"file_ops"`;
  const arrStart = buf.indexOf(marker);
  if (arrStart === -1) return ops;

  let i = arrStart + marker.length;
  while (i < buf.length && buf[i] !== "[") i++;
  if (i >= buf.length) return ops;
  i++; // skip '['

  while (i < buf.length) {
    const objStart = buf.indexOf("{", i);
    if (objStart === -1) break;

    const op = extractFieldValue(buf, objStart, "op");
    const path = extractFieldValue(buf, objStart, "path");
    if (op && path) {
      ops.push({ op, path });
    }

    // Skip past this object (find matching '}' accounting for nested strings)
    const objEnd = findObjectEnd(buf, objStart);
    if (objEnd === -1) break;
    i = objEnd + 1;
  }

  return ops;
}

function extractFieldValue(buf: string, searchFrom: number, fieldName: string): string | null {
  const marker = `"${fieldName}"`;
  const idx = buf.indexOf(marker, searchFrom);
  if (idx === -1) return null;

  // Don't look beyond the "content" field which is huge
  if (fieldName !== "content") {
    const contentIdx = buf.indexOf(`"content"`, searchFrom);
    if (contentIdx !== -1 && idx > contentIdx) return null;
  }

  let i = idx + marker.length;
  while (i < buf.length && buf[i] !== ":") i++;
  i++;
  while (i < buf.length && (buf[i] === " " || buf[i] === "\n" || buf[i] === "\r" || buf[i] === "\t")) i++;
  if (i >= buf.length || buf[i] !== '"') return null;

  return extractJsonString(buf, i);
}

function extractJsonString(buf: string, start: number): string | null {
  if (buf[start] !== '"') return null;
  let i = start + 1;
  const chars: string[] = [];
  while (i < buf.length) {
    if (buf[i] === "\\") {
      i++;
      if (i >= buf.length) break;
      const esc = buf[i];
      if (esc === '"') chars.push('"');
      else if (esc === "\\") chars.push("\\");
      else if (esc === "n") chars.push("\n");
      else if (esc === "r") chars.push("\r");
      else if (esc === "t") chars.push("\t");
      else chars.push(esc);
    } else if (buf[i] === '"') {
      return chars.join("");
    } else {
      chars.push(buf[i]);
    }
    i++;
  }
  // Unterminated string — return what we have so far
  return chars.join("");
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
