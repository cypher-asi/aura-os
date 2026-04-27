import type { TimelineItem, ToolCallEntry } from "../shared/types/stream";

type ToolMarkerStatus = "ok" | "error";

/**
 * Pseudo-tool gate labels we hoist out of LLM prose. These are not real
 * tool calls — the LLM (or an upstream hook) writes them into its prose
 * to announce a build/test step or report its outcome. We recognize them
 * so they render through the shared Block registry as `run_command`
 * cards instead of falling through to `SegmentedContent` as raw markdown.
 */
type PseudoGateLabel = "auto-build" | "task_done test gate";

const PSEUDO_GATE_LABELS: readonly PseudoGateLabel[] = [
  "auto-build",
  "task_done test gate",
];

export type ToolMarkerSegment =
  | { kind: "text"; content: string }
  | {
      kind: "tool";
      name: string;
      arg?: string;
      status: ToolMarkerStatus;
      raw: string;
    }
  | {
      kind: "pseudo-tool";
      gate: PseudoGateLabel;
      body: string;
      raw: string;
    };

const TOOL_MARKER_RE =
  /\[tool:\s*([A-Za-z0-9_.:-]+)(?:\(([^)]*)\)|\s+([^\]\r\n]*?))?\s*(?:->|→)\s*(ok|error)\s*\]/g;

// Recognized prose markers of the form `[<gate>: <body>]` where `<gate>`
// is one of the PSEUDO_GATE_LABELS and `<body>` runs to the closing `]`
// on the same line. Body may contain parens (e.g.
// `(source: manifest auto-detect)`) since the character class only
// excludes `]` and newlines.
const PSEUDO_TOOL_MARKER_RE =
  /\[(auto-build|task_done test gate):\s*([^\]\r\n]+?)\s*\]/g;

const PSEUDO_GATE_PREFIXES: readonly string[] = PSEUDO_GATE_LABELS.map(
  (label) => `[${label}:`,
);

const TOOL_ALIAS_MAP: Record<string, string> = {
  read: "read_file",
  list: "list_files",
  find: "find_files",
  search: "search_code",
  run: "run_command",
  write: "write_file",
  edit: "edit_file",
  delete: "delete_file",
};

function normalizeToolMarkerName(name: string): string {
  return TOOL_ALIAS_MAP[name] ?? name;
}

function normalizeArg(arg: string | undefined): string | undefined {
  const trimmed = arg?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^["'`]|["'`]$/g, "");
}

export function trimIncompleteToolMarkerTail(text: string): string {
  // Find the latest opening of any recognized marker prefix. While the
  // LLM is mid-token we don't want to flash a half-typed `[tool:` or
  // `[auto-build:` to the user, so if the trailing fragment cannot yet
  // form a complete marker we strip it from the visible text.
  const candidates: number[] = [];
  const idxTool = text.lastIndexOf("[tool:");
  if (idxTool !== -1) candidates.push(idxTool);
  for (const prefix of PSEUDO_GATE_PREFIXES) {
    const idx = text.lastIndexOf(prefix);
    if (idx !== -1) candidates.push(idx);
  }
  if (candidates.length === 0) return text;

  const lastMarkerStart = Math.max(...candidates);
  const tail = text.slice(lastMarkerStart);

  TOOL_MARKER_RE.lastIndex = 0;
  if (TOOL_MARKER_RE.test(tail)) return text;
  PSEUDO_TOOL_MARKER_RE.lastIndex = 0;
  if (PSEUDO_TOOL_MARKER_RE.test(tail)) return text;

  if (!tail.includes("]")) return text.slice(0, lastMarkerStart).trimEnd();
  return text;
}

interface RawMatch {
  index: number;
  length: number;
  segment: Extract<ToolMarkerSegment, { kind: "tool" } | { kind: "pseudo-tool" }>;
}

function collectMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];

  TOOL_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_MARKER_RE.exec(text)) !== null) {
    matches.push({
      index: m.index,
      length: m[0].length,
      segment: {
        kind: "tool",
        name: normalizeToolMarkerName(m[1]),
        arg: normalizeArg(m[2] ?? m[3]),
        status: m[4] as ToolMarkerStatus,
        raw: m[0],
      },
    });
  }

  PSEUDO_TOOL_MARKER_RE.lastIndex = 0;
  while ((m = PSEUDO_TOOL_MARKER_RE.exec(text)) !== null) {
    matches.push({
      index: m.index,
      length: m[0].length,
      segment: {
        kind: "pseudo-tool",
        gate: m[1] as PseudoGateLabel,
        body: m[2].trim(),
        raw: m[0],
      },
    });
  }

  matches.sort((a, b) => a.index - b.index);

  // Defensive overlap filter. The two regexes have disjoint prefixes
  // (`[tool:` vs `[<gate>:`) so they should never overlap in practice,
  // but if some future label aliases into a tool: form we drop the
  // later match instead of producing nested segments.
  const filtered: RawMatch[] = [];
  let lastEnd = -1;
  for (const match of matches) {
    if (match.index < lastEnd) continue;
    filtered.push(match);
    lastEnd = match.index + match.length;
  }
  return filtered;
}

export function splitTextByToolMarkers(text: string): ToolMarkerSegment[] | null {
  const matches = collectMatches(text);
  if (matches.length === 0) return null;

  const segments: ToolMarkerSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      const content = text.slice(cursor, match.index);
      if (content) segments.push({ kind: "text", content });
    }
    segments.push(match.segment);
    cursor = match.index + match.length;
  }
  if (cursor < text.length) {
    const content = text.slice(cursor);
    if (content) segments.push({ kind: "text", content });
  }

  return segments.length > 0 ? segments : null;
}

function inputFromMarker(name: string, arg: string | undefined): Record<string, unknown> {
  if (!arg) return {};
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
    case "list_files":
      return { path: arg };
    case "find_files":
      return { pattern: arg };
    case "search_code":
      return { query: arg };
    case "run_command":
      return { command: arg };
    default:
      return { raw_input: arg };
  }
}

function markerResult(name: string, status: ToolMarkerStatus): string {
  return status === "error"
    ? `${name} failed`
    : `${name} completed`;
}

function uniqueToolId(base: string, usedIds: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  usedIds.add(candidate);
  return candidate;
}

const RESULT_BODY_RE = /^(PASSED|FAILED)\b/i;
const FAILED_BODY_RE = /^FAILED\b/i;

interface PseudoEntryMeta {
  gate: PseudoGateLabel;
  isResult: boolean;
}

function pseudoToToolCall(
  segment: Extract<ToolMarkerSegment, { kind: "pseudo-tool" }>,
  id: string,
): { entry: ToolCallEntry; meta: PseudoEntryMeta } {
  const isResult = RESULT_BODY_RE.test(segment.body);
  const isError = isResult && FAILED_BODY_RE.test(segment.body);
  const entry: ToolCallEntry = {
    id,
    name: "run_command",
    input: { command: isResult ? segment.gate : segment.body },
    result: isResult ? segment.body : undefined,
    isError,
    pending: false,
  };
  return { entry, meta: { gate: segment.gate, isResult } };
}

function gateSlug(gate: PseudoGateLabel): string {
  return gate.replace(/[^A-Za-z0-9]+/g, "_");
}

export function expandToolMarkersInTimeline(
  timeline: TimelineItem[],
  toolCalls: ToolCallEntry[] = [],
): { timeline: TimelineItem[]; toolCalls: ToolCallEntry[] } {
  const usedIds = new Set(toolCalls.map((tc) => tc.id));
  const expandedTimeline: TimelineItem[] = [];
  const expandedToolCalls = [...toolCalls];
  const pseudoMeta = new Map<string, PseudoEntryMeta>();

  for (const item of timeline) {
    if (item.kind !== "text") {
      expandedTimeline.push(item);
      continue;
    }

    const segments = splitTextByToolMarkers(item.content);
    if (!segments) {
      expandedTimeline.push(item);
      continue;
    }

    segments.forEach((segment, index) => {
      if (segment.kind === "text") {
        if (segment.content.trim().length > 0) {
          expandedTimeline.push({
            kind: "text",
            content: segment.content,
            id: `${item.id}-text-${index}`,
          });
        }
        return;
      }

      if (segment.kind === "pseudo-tool") {
        const id = uniqueToolId(
          `${item.id}-pseudo-${index}-${gateSlug(segment.gate)}`,
          usedIds,
        );
        const { entry, meta } = pseudoToToolCall(segment, id);
        expandedToolCalls.push(entry);
        pseudoMeta.set(id, meta);
        expandedTimeline.push({
          kind: "tool",
          toolCallId: id,
          id: `${item.id}-pseudo-item-${index}`,
        });
        return;
      }

      const id = uniqueToolId(`${item.id}-tool-${index}-${segment.name}`, usedIds);
      expandedToolCalls.push({
        id,
        name: segment.name,
        input: inputFromMarker(segment.name, segment.arg),
        result: markerResult(segment.name, segment.status),
        isError: segment.status === "error",
        pending: false,
      });
      expandedTimeline.push({
        kind: "tool",
        toolCallId: id,
        id: `${item.id}-tool-item-${index}`,
      });
    });
  }

  return mergePseudoPairs(expandedTimeline, expandedToolCalls, pseudoMeta);
}

/**
 * Pair an `auto-build` / `task_done test gate` announcement entry with
 * the matching PASSED/FAILED result entry that follows it (separated
 * only by whitespace text items) into a single CommandBlock entry. The
 * announcement keeps its `command` from the body of the first marker
 * and absorbs `result`/`isError` from the second; the second timeline
 * item and tool-call entry are dropped.
 */
function mergePseudoPairs(
  timeline: TimelineItem[],
  toolCalls: ToolCallEntry[],
  pseudoMeta: Map<string, PseudoEntryMeta>,
): { timeline: TimelineItem[]; toolCalls: ToolCallEntry[] } {
  if (pseudoMeta.size === 0) {
    return { timeline, toolCalls };
  }

  const toolCallById = new Map(toolCalls.map((tc) => [tc.id, tc]));
  const removedIds = new Set<string>();

  for (let i = 0; i < timeline.length; i++) {
    const left = timeline[i];
    if (left.kind !== "tool") continue;
    const leftMeta = pseudoMeta.get(left.toolCallId);
    if (!leftMeta || leftMeta.isResult) continue;
    const leftEntry = toolCallById.get(left.toolCallId);
    if (!leftEntry) continue;

    let j = i + 1;
    while (j < timeline.length) {
      const next = timeline[j];
      if (next.kind === "text" && next.content.trim().length === 0) {
        j++;
        continue;
      }
      break;
    }
    if (j >= timeline.length) continue;

    const right = timeline[j];
    if (right.kind !== "tool") continue;
    const rightMeta = pseudoMeta.get(right.toolCallId);
    if (!rightMeta || !rightMeta.isResult) continue;
    if (rightMeta.gate !== leftMeta.gate) continue;
    const rightEntry = toolCallById.get(right.toolCallId);
    if (!rightEntry) continue;

    leftEntry.result = rightEntry.result;
    leftEntry.isError = rightEntry.isError;
    removedIds.add(rightEntry.id);
    i = j;
  }

  if (removedIds.size === 0) {
    return { timeline, toolCalls };
  }

  const filteredTimeline = timeline.filter(
    (item) => item.kind !== "tool" || !removedIds.has(item.toolCallId),
  );
  const filteredToolCalls = toolCalls.filter((tc) => !removedIds.has(tc.id));

  return { timeline: filteredTimeline, toolCalls: filteredToolCalls };
}
