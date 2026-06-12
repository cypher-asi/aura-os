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

// Argument capture uses `[^\]\r\n]*?` (lazy, single-line, marker-bounded)
// instead of `[^)]*` so nested parens like `search_code(pub fn (a|b),
// context=2)` are absorbed up to the outermost `)` that is followed by
// the marker tail. Mirrors the canonical regex in
// `interface/src/utils/tool-markers.ts`. The arrow alternation accepts
// both `->` and `→` because the server-emitted form is the unicode
// arrow (see the sidekick Run pane screenshots).
const TOOL_MARKER_RE =
  /\[tool:\s*(\S+?)(?:\(([^\]\r\n]*?)\))?\s*(?:->|→)\s*(ok|error)\]/g;
const TOOL_MARKER_TEST =
  /\[tool:\s*\S+?(?:\([^\]\r\n]*?\))?\s*(?:->|→)\s*(?:ok|error)\]/;

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

/**
 * Best-effort plain-language description of a shell command, so a chat
 * row can read "Check git remotes" instead of leading with the raw
 * `$ git remote -v`. Only the first command of a `&&` / `;` / `|` chain
 * is classified. Returns `null` when no confident description exists so
 * callers can fall back to a generic label — a wrong guess is worse
 * than no guess.
 *
 * A server-provided description (if the harness ever sends one with
 * `run_command`) should take precedence over this heuristic.
 */
export function describeCommand(command: string): string | null {
  const first = command.split(/&&|;|\|/, 1)[0]?.trim() ?? "";
  if (!first) return null;

  // Drop leading env assignments (`FOO=bar cmd`) and `sudo`.
  const tokens = first.split(/\s+/).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  if (tokens[0] === "sudo") tokens.shift();
  const [bin, sub] = tokens;
  if (!bin) return null;

  switch (bin) {
    case "git":
      switch (sub) {
        case "status": return "Check git status";
        case "remote": return "Check git remotes";
        case "init": return "Initialize git repository";
        case "clone": return "Clone repository";
        case "pull": return "Pull latest changes";
        case "push": return "Push changes";
        case "fetch": return "Fetch remote changes";
        case "add": return "Stage changes";
        case "commit": return "Commit changes";
        case "checkout":
        case "switch": return "Switch branch";
        case "branch": return "Manage branches";
        case "merge": return "Merge branches";
        case "rebase": return "Rebase branch";
        case "stash": return "Stash changes";
        case "log": return "Inspect git history";
        case "diff": return "Review changes";
        default: return sub ? `Run git ${sub}` : "Run git";
      }
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      if (sub === "install" || sub === "i" || sub === "add" || sub === undefined) {
        return "Install dependencies";
      }
      if (sub === "test" || sub === "t") return "Run tests";
      if (sub === "run") {
        const script = tokens[2];
        if (script === "build") return "Build project";
        if (script === "dev" || script === "start") return "Start dev server";
        if (script === "test") return "Run tests";
        if (script === "lint") return "Lint code";
        return script ? `Run ${script} script` : null;
      }
      if (sub === "build") return "Build project";
      if (sub === "start" || sub === "dev") return "Start dev server";
      return null;
    case "cargo":
      switch (sub) {
        case "build": return "Build project";
        case "test": return "Run tests";
        case "check": return "Check project compiles";
        case "run": return "Run project";
        case "fmt": return "Format code";
        case "clippy": return "Lint code";
        case "add": return "Add dependency";
        default: return sub ? `Run cargo ${sub}` : null;
      }
    case "pytest":
    case "jest":
    case "vitest":
      return "Run tests";
    case "pip":
    case "pip3":
    case "uv":
      if (sub === "install" || sub === "add" || sub === "sync") {
        return "Install dependencies";
      }
      return null;
    case "mkdir": return "Create directory";
    case "rm":
    case "del": return "Remove files";
    case "cp":
    case "copy": return "Copy files";
    case "mv":
    case "move": return "Move files";
    case "ls":
    case "dir": return "List directory";
    case "cat":
    case "type": return "Show file contents";
    case "curl":
    case "wget": return "Fetch URL";
    case "docker":
      if (sub === "build") return "Build container image";
      if (sub === "compose" || sub === "up") return "Start containers";
      if (sub === "ps") return "List containers";
      return null;
    default:
      return null;
  }
}

export function agenticToolLabel(toolName: string, arg?: string): string {
  const shortArg = arg ? shortenArg(arg, 60) : "";
  if (toolName === "run_command" && arg) {
    const described = describeCommand(arg);
    if (described) return described;
  }
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
