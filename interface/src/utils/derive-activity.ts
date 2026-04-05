import { deriveLegacyJsonActivity } from "./derive-activity-transforms";

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

export function agenticToolLabel(toolName: string, arg?: string): string {
  const shortArg = arg ? shortenArg(arg, 60) : "";
  switch (toolName) {
    case "read_file": return shortArg ? `Read \`${shortArg}\`` : "Read file";
    case "write_file": return shortArg ? `Write \`${shortArg}\`` : "Write file";
    case "edit_file": return shortArg ? `Edit \`${shortArg}\`` : "Edit file";
    case "delete_file": return shortArg ? `Delete \`${shortArg}\`` : "Delete file";
    case "list_files": return shortArg ? `List \`${shortArg}\`` : "List files";
    case "find_files": return shortArg ? `Find \`${shortArg}\`` : "Find files";
    case "search_code": return shortArg ? `Search: ${shortArg}` : "Search code";
    case "run_command": return shortArg ? `Run: \`${shortArg}\`` : "Run command";
    case "stat_file": return shortArg ? `Info: \`${shortArg}\`` : "File info";
    case "submit_plan": return "Submit plan";
    case "task_done": return "Task complete";
    case "get_task_context": return "Load context";
    case "git_commit": return shortArg ? `Commit ${shortArg}` : "Commit code";
    case "git_push": return shortArg ? `Push ${shortArg}` : "Push code";
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

/* ── Iteration stats for complexity visualization ── */

export type ToolCategory = "read" | "write" | "command" | "other";

export interface IterationDot {
  category: ToolCategory;
  isError: boolean;
}

export interface IterationStats {
  total: number;
  reads: number;
  writes: number;
  commands: number;
  errors: number;
  dots: IterationDot[];
}

const READ_TOOLS = new Set(["read_file", "list_files", "search_code", "get_task_context"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);
const COMMAND_TOOLS = new Set(["run_command"]);

function categorize(toolName: string): ToolCategory {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (COMMAND_TOOLS.has(toolName)) return "command";
  return "other";
}

export function computeIterationStats(buffer: string): IterationStats {
  const stats: IterationStats = { total: 0, reads: 0, writes: 0, commands: 0, errors: 0, dots: [] };
  if (!buffer) return stats;

  TOOL_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_MARKER_RE.exec(buffer)) !== null) {
    const toolName = match[1];
    const isError = match[3] === "error";
    const cat = categorize(toolName);

    stats.total++;
    if (isError) stats.errors++;
    if (cat === "read") stats.reads++;
    else if (cat === "write") stats.writes++;
    else if (cat === "command") stats.commands++;

    stats.dots.push({ category: cat, isError });
  }

  return stats;
}
