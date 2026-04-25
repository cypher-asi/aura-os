import type { TimelineItem, ToolCallEntry } from "../shared/types/stream";

type ToolMarkerStatus = "ok" | "error";

export type ToolMarkerSegment =
  | { kind: "text"; content: string }
  | {
      kind: "tool";
      name: string;
      arg?: string;
      status: ToolMarkerStatus;
      raw: string;
    };

const TOOL_MARKER_RE =
  /\[tool:\s*([A-Za-z0-9_.:-]+)(?:\(([^)]*)\)|\s+([^\]\r\n]*?))?\s*(?:->|→)\s*(ok|error)\s*\]/g;

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
  const lastMarkerStart = text.lastIndexOf("[tool:");
  if (lastMarkerStart === -1) return text;

  const tail = text.slice(lastMarkerStart);
  TOOL_MARKER_RE.lastIndex = 0;
  if (TOOL_MARKER_RE.test(tail)) return text;
  if (!tail.includes("]")) return text.slice(0, lastMarkerStart).trimEnd();
  return text;
}

export function splitTextByToolMarkers(text: string): ToolMarkerSegment[] | null {
  TOOL_MARKER_RE.lastIndex = 0;
  const first = TOOL_MARKER_RE.exec(text);
  if (!first) return null;

  TOOL_MARKER_RE.lastIndex = 0;
  const segments: ToolMarkerSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = TOOL_MARKER_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      const content = text.slice(cursor, match.index);
      if (content) segments.push({ kind: "text", content });
    }

    segments.push({
      kind: "tool",
      name: normalizeToolMarkerName(match[1]),
      arg: normalizeArg(match[2] ?? match[3]),
      status: match[4] as ToolMarkerStatus,
      raw: match[0],
    });
    cursor = match.index + match[0].length;
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

export function expandToolMarkersInTimeline(
  timeline: TimelineItem[],
  toolCalls: ToolCallEntry[] = [],
): { timeline: TimelineItem[]; toolCalls: ToolCallEntry[] } {
  const usedIds = new Set(toolCalls.map((tc) => tc.id));
  const expandedTimeline: TimelineItem[] = [];
  const expandedToolCalls = [...toolCalls];

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

  return { timeline: expandedTimeline, toolCalls: expandedToolCalls };
}
