import type { TimelineItem, ToolCallEntry } from "../shared/types/stream";

type ToolMarkerStatus = "ok" | "error";

/**
 * Pseudo-tool gate labels we hoist out of LLM prose. These are not real
 * tool calls — the LLM (or an upstream hook) writes them into its prose
 * to announce a build/test step or report its outcome. We recognize them
 * so they render through the shared Block registry as `run_command`
 * cards instead of falling through to `SegmentedContent` as raw markdown.
 *
 * `post-task_done test run` is emitted by the harness's
 * `handle_task_done` flow (see `aura-harness/crates/aura-agent/src/
 * task_executor/handlers.rs`) as a best-effort suite invocation that
 * surfaces a PASSED/FAILED outcome but never gates completion. The
 * announcement carries the resolved command and source; the trailing
 * marker carries the result body.
 */
type PseudoGateLabel =
  | "auto-build"
  | "task_done test gate"
  | "post-task_done test run";

const PSEUDO_GATE_LABELS: readonly PseudoGateLabel[] = [
  "auto-build",
  "task_done test gate",
  "post-task_done test run",
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
    }
  // Compaction dialect emitted by the server when it renders persisted
  // tool activity back into flat assistant text on a cold-start history
  // rebuild (`render_block_into` in
  // `apps/aura-os-server/src/handlers/agents/chat/compaction.rs`). A
  // `tool_use` carries the tool name + JSON input; a `tool_result` /
  // `tool_error` carries the (possibly truncated) result body. They are
  // hoisted into real `ToolCallEntry`s so e.g. `list_tasks` renders
  // through the shared Block registry instead of as literal text.
  | {
      kind: "compact-tool-use";
      name: string;
      input: Record<string, unknown>;
      raw: string;
    }
  | {
      kind: "compact-tool-result";
      isError: boolean;
      content: string;
      raw: string;
    };

// Argument capture uses `[^\]\r\n]*?` (lazy, single-line, marker-bounded)
// rather than `[^)]*` so nested parens inside the arg — e.g.
// `search_code(pub fn (a|b), context=2)` — are absorbed up to the
// outermost `)` that is followed by ` -> ok|error]`. Bounding by `]`
// and newlines also stops the lazy match from leaking into a
// downstream marker that happens to share the same line.
const TOOL_MARKER_RE =
  /\[tool:\s*([A-Za-z0-9_.:-]+)(?:\(([^\]\r\n]*?)\)|\s+([^\]\r\n]*?))?\s*(?:->|→)\s*(ok|error)\s*\]/g;

// Recognized prose markers of the form `[<gate>: <body>]` where `<gate>`
// is one of the PSEUDO_GATE_LABELS and `<body>` runs to the closing `]`
// on the same line. Body may contain parens (e.g.
// `(source: manifest auto-detect)`) since the character class only
// excludes `]` and newlines.
const PSEUDO_TOOL_MARKER_RE =
  /\[(auto-build|task_done test gate|post-task_done test run):\s*([^\]\r\n]+?)\s*\]/g;

const PSEUDO_GATE_PREFIXES: readonly string[] = PSEUDO_GATE_LABELS.map(
  (label) => `[${label}:`,
);

// Compaction-dialect openers. The trailing space is part of the literal
// the server emits (`[tool_use <name> ...`).
const COMPACT_USE_PREFIX = "[tool_use ";
const COMPACT_RESULT_PREFIX = "[tool_result ";
const COMPACT_ERROR_PREFIX = "[tool_error ";
const COMPACT_PREFIXES: readonly string[] = [
  COMPACT_USE_PREFIX,
  COMPACT_RESULT_PREFIX,
  COMPACT_ERROR_PREFIX,
];

// Every recognized marker opener across all dialects. A compaction
// marker's body is matched greedily (its JSON can contain `]` and
// newlines), so we bound that greed at the next opener of any dialect to
// stop one marker from swallowing the next.
const ALL_MARKER_OPENERS: readonly string[] = [
  ...COMPACT_PREFIXES,
  "[tool:",
  ...PSEUDO_GATE_PREFIXES,
];

// Prefixes used only to detect an in-flight (not-yet-closed) compaction
// marker tail while streaming. Omits the trailing space so a half-typed
// `[tool_use` is hidden before the space even arrives.
const COMPACT_TRIM_PREFIXES: readonly string[] = [
  "[tool_use",
  "[tool_result",
  "[tool_error",
];

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
  for (const prefix of COMPACT_TRIM_PREFIXES) {
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
  segment: Extract<
    ToolMarkerSegment,
    | { kind: "tool" }
    | { kind: "pseudo-tool" }
    | { kind: "compact-tool-use" }
    | { kind: "compact-tool-result" }
  >;
}

function nextMarkerOpener(text: string, from: number): number {
  let best = -1;
  for (const opener of ALL_MARKER_OPENERS) {
    const idx = text.indexOf(opener, from);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

// Locate the `]` that closes a compaction marker whose body may itself
// contain `]` and newlines. Marker parts are newline-joined, so the real
// close is a `]` that ends a line (followed by `\n` or the region end);
// fall back to the last `]` in the region when no line-closing bracket is
// found (e.g. a trailing marker concatenated without a newline).
function findCompactClose(
  text: string,
  contentStart: number,
  regionEnd: number,
): number {
  for (let p = regionEnd - 1; p >= contentStart; p--) {
    if (text[p] !== "]") continue;
    const after = p + 1;
    if (after >= regionEnd || text[after] === "\n") return p;
  }
  const fallback = text.lastIndexOf("]", regionEnd - 1);
  return fallback >= contentStart ? fallback : -1;
}

function parseCompactUseInner(
  inner: string,
): { name: string; input: Record<string, unknown> } | null {
  const m = /^(\S+)\s+input=([\s\S]*)$/.exec(inner.trim());
  if (!m) return null;
  const name = m[1];
  // The input is single-line JSON from `serde_json::to_string`, but a
  // long blob may have been truncated to `...[truncated N bytes]` and no
  // longer parse. Degrade to an empty/raw input rather than dropping the
  // whole marker so the tool card still renders.
  try {
    const parsed: unknown = JSON.parse(m[2]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { name, input: parsed as Record<string, unknown> };
    }
    return { name, input: { raw_input: m[2] } };
  } catch {
    return { name, input: {} };
  }
}

function collectCompactionMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const prefix of COMPACT_PREFIXES) {
    let from = 0;
    let start: number;
    while ((start = text.indexOf(prefix, from)) !== -1) {
      const contentStart = start + prefix.length;
      const nextOpener = nextMarkerOpener(text, contentStart);
      const regionEnd = nextOpener === -1 ? text.length : nextOpener;
      const close = findCompactClose(text, contentStart, regionEnd);
      if (close === -1) {
        // No closing bracket yet (still streaming) — leave as text.
        from = contentStart;
        continue;
      }
      const raw = text.slice(start, close + 1);
      const inner = text.slice(contentStart, close);
      if (prefix === COMPACT_USE_PREFIX) {
        const parsed = parseCompactUseInner(inner);
        if (parsed) {
          matches.push({
            index: start,
            length: raw.length,
            segment: {
              kind: "compact-tool-use",
              name: parsed.name,
              input: parsed.input,
              raw,
            },
          });
        }
      } else {
        matches.push({
          index: start,
          length: raw.length,
          segment: {
            kind: "compact-tool-result",
            isError: prefix === COMPACT_ERROR_PREFIX,
            content: inner.trim(),
            raw,
          },
        });
      }
      from = close + 1;
    }
  }
  return matches;
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

  for (const match of collectCompactionMatches(text)) {
    matches.push(match);
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

interface CompactEntryMeta {
  isResult: boolean;
  isError: boolean;
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
  const compactMeta = new Map<string, CompactEntryMeta>();

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

      if (segment.kind === "compact-tool-use") {
        const id = uniqueToolId(
          `${item.id}-tooluse-${index}-${segment.name}`,
          usedIds,
        );
        expandedToolCalls.push({
          id,
          name: segment.name,
          input: segment.input,
          isError: false,
          pending: false,
        });
        compactMeta.set(id, { isResult: false, isError: false });
        expandedTimeline.push({
          kind: "tool",
          toolCallId: id,
          id: `${item.id}-tooluse-item-${index}`,
        });
        return;
      }

      if (segment.kind === "compact-tool-result") {
        const id = uniqueToolId(`${item.id}-toolresult-${index}`, usedIds);
        expandedToolCalls.push({
          id,
          name: "tool_result",
          input: {},
          result: segment.content,
          isError: segment.isError,
          pending: false,
        });
        compactMeta.set(id, { isResult: true, isError: segment.isError });
        expandedTimeline.push({
          kind: "tool",
          toolCallId: id,
          id: `${item.id}-toolresult-item-${index}`,
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

  const pseudoMerged = mergePseudoPairs(
    expandedTimeline,
    expandedToolCalls,
    pseudoMeta,
  );
  return mergeCompactionPairs(
    pseudoMerged.timeline,
    pseudoMerged.toolCalls,
    compactMeta,
  );
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

/**
 * Fold a compaction `tool_use` entry together with the `tool_result` /
 * `tool_error` entry that immediately follows it (separated only by
 * whitespace text) into a single tool-call entry: the `tool_use` keeps
 * its name + input and absorbs the result body + error flag from the
 * pairing entry, whose timeline item and tool-call entry are dropped.
 * Unpaired entries (an orphan use, or a result with no preceding use)
 * survive on their own.
 */
function mergeCompactionPairs(
  timeline: TimelineItem[],
  toolCalls: ToolCallEntry[],
  compactMeta: Map<string, CompactEntryMeta>,
): { timeline: TimelineItem[]; toolCalls: ToolCallEntry[] } {
  if (compactMeta.size === 0) {
    return { timeline, toolCalls };
  }

  const toolCallById = new Map(toolCalls.map((tc) => [tc.id, tc]));
  const removedIds = new Set<string>();

  for (let i = 0; i < timeline.length; i++) {
    const left = timeline[i];
    if (left.kind !== "tool") continue;
    const leftMeta = compactMeta.get(left.toolCallId);
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
    const rightMeta = compactMeta.get(right.toolCallId);
    if (!rightMeta || !rightMeta.isResult) continue;
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
