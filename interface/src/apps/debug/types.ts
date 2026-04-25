/**
 * Debug-specific view models. Domain-level DTOs live in
 * `interface/src/api/debug.ts`; this file only holds UI-local helpers
 * shared across components in the Debug app.
 */

import type { DebugChannel } from "../../shared/api/debug";

/**
 * A parsed line from any `*.jsonl` channel. `event` keeps the raw
 * payload so the Inspector pane can show the full JSON; `type`,
 * `timestamp`, and `channel` are extracted for filtering and timeline
 * display.
 */
export interface DebugLogEntry {
  /** Stable index in file order; used as a react key. */
  index: number;
  /** ISO 8601 timestamp when the server persisted the event. */
  timestamp: string | null;
  /** The `event.type` discriminator. `unknown` if the field is missing. */
  type: string;
  /** The channel this line came from (useful when multiplexing). */
  channel: DebugChannel;
  /** The line of JSON, unparsed, for export / copy. */
  raw: string;
  /** The parsed payload — `unknown` so callers must narrow. */
  event: unknown;
}

/**
 * A filter applied to the log viewer. `types` narrows by event kind;
 * `text` is substring-matched against the raw JSON line so free-text
 * searches still work without a structured query language.
 */
export interface DebugLogFilter {
  channel: DebugChannel;
  types: ReadonlySet<string>;
  text: string;
}

export const DEFAULT_LOG_FILTER: DebugLogFilter = {
  channel: "events",
  types: new Set<string>(),
  text: "",
};
