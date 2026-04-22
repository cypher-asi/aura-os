import type { DebugLogEntry } from "./types";

/**
 * Render a one-line summary of a debug log entry for the timeline.
 * The full JSON is available in the sidekick inspector when a row is
 * selected, so this column never emits raw JSON; it always produces a
 * short, human-oriented label (task name, tool name, model, etc.).
 */
export function summarizeEntry(entry: DebugLogEntry): string {
  const event = entry.event as Record<string, unknown> | null;
  if (!event) {
    // Defensive: if we couldn't parse the line, fall back to the type
    // string the parser assigned (e.g. "parse_error") instead of
    // spilling raw bytes into the timeline.
    return entry.type === "unknown" ? "" : entry.type;
  }

  const type = entry.type;
  const payload = (event.payload ?? event) as Record<string, unknown>;

  switch (type) {
    case "debug.llm_call": {
      const model = str(payload.model);
      const provider = str(payload.provider);
      const inputTokens = num(payload.input_tokens);
      const outputTokens = num(payload.output_tokens);
      const durationMs = num(payload.duration_ms);
      const parts: string[] = [];
      if (provider) parts.push(provider);
      if (model) parts.push(model);
      if (inputTokens !== null) parts.push(`${inputTokens}→${outputTokens ?? "?"}t`);
      if (durationMs !== null) parts.push(`${durationMs}ms`);
      return parts.join(" · ");
    }
    case "debug.retry": {
      const reason = str(payload.reason);
      const attempt = num(payload.attempt);
      const waitMs = num(payload.wait_ms);
      const parts: string[] = [];
      if (attempt !== null) parts.push(`attempt ${attempt}`);
      if (waitMs !== null) parts.push(`${waitMs}ms`);
      if (reason) parts.push(reason);
      return parts.join(" · ");
    }
    case "debug.blocker": {
      const kind = str(payload.kind);
      const path = str(payload.path);
      const message = str(payload.message);
      return [kind, path, message].filter(Boolean).join(" · ");
    }
    case "debug.iteration": {
      const index = num(payload.index);
      const toolCalls = num(payload.tool_calls);
      const parts: string[] = [];
      if (index !== null) parts.push(`#${index}`);
      if (toolCalls !== null) parts.push(`${toolCalls} tools`);
      return parts.join(" · ");
    }
    case "tool_call": {
      // Emit only the tool name. The full arguments are available in
      // the sidekick inspector when a row is selected; embedding
      // JSON-serialized args here resurfaces exactly the kind of
      // noise we explicitly moved off the timeline.
      return str(payload.name) ?? str(event.name) ?? "";
    }
    case "task_completed":
    case "task_failed":
    case "task_started": {
      const name =
        str(payload.task_name) ??
        str(event.task_name) ??
        str(payload.name) ??
        str(event.name);
      const taskId = str(event.task_id) ?? str(payload.task_id);
      return name ?? taskId ?? "";
    }
    default: {
      // Unknown / app-specific event types. Never return raw JSON;
      // prefer whatever task/tool/name identifier the payload carries
      // so the timeline reads as a list of named actions. If nothing
      // usable is present, fall back to the event type itself.
      return (
        str(payload.task_name) ??
        str(event.task_name) ??
        str(payload.name) ??
        str(event.name) ??
        str(payload.title) ??
        str(event.title) ??
        str(event.task_id) ??
        str(payload.task_id) ??
        (type === "unknown" ? "" : type)
      );
    }
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Extract the set of unique event `type` strings in the entries, in
 * first-seen order. Drives the `type` filter dropdown.
 */
export function collectTypes(entries: DebugLogEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.type)) continue;
    seen.add(entry.type);
    out.push(entry.type);
  }
  out.sort();
  return out;
}
