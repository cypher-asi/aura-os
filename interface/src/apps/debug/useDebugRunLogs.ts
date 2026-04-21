import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DebugChannel } from "../../api/debug";
import type { ProjectId } from "../../types";
import type { DebugLogEntry } from "./types";

interface Params {
  projectId: ProjectId | undefined;
  runId: string | undefined;
  channel: DebugChannel;
  isRunning: boolean;
}

interface Result {
  entries: DebugLogEntry[];
  raw: string;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Lines in a debug bundle are written by `loop_log::LoopLogWriter` as
 * `{ "_ts": "<iso>", "event": { "type": "...", ... } }`. Older frames
 * may omit the envelope, so we fall back to reading `type` / `ts` /
 * `timestamp` off the outer object when the inner `event` is missing.
 */
function parseJsonl(raw: string, channel: DebugChannel): DebugLogEntry[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out: DebugLogEntry[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Keep malformed lines visible instead of dropping them.
      out.push({
        index: out.length,
        timestamp: null,
        type: "parse_error",
        channel,
        raw: line,
        event: { error: "failed to parse line", line },
      });
      continue;
    }
    const envelope = (
      parsed && typeof parsed === "object" ? parsed : {}
    ) as Record<string, unknown>;
    const innerEvent =
      envelope.event && typeof envelope.event === "object"
        ? (envelope.event as Record<string, unknown>)
        : envelope;
    const typeValue = innerEvent.type ?? envelope.type;
    const timestampValue =
      envelope._ts ?? envelope.ts ?? envelope.timestamp ?? innerEvent.timestamp;
    out.push({
      index: out.length,
      timestamp:
        typeof timestampValue === "string" ? timestampValue : null,
      type: typeof typeValue === "string" ? typeValue : "unknown",
      channel,
      raw: line,
      event: innerEvent,
    });
  }
  return out;
}

/**
 * Loads and parses a JSONL channel from a debug run bundle. Polls the
 * server while the run is still in-flight so the UI stays live without
 * requiring WebSocket multiplexing on the client side.
 */
export function useDebugRunLogs({
  projectId,
  runId,
  channel,
  isRunning,
}: Params): Result {
  const query = useQuery({
    queryKey: ["debug", "run-logs", projectId, runId, channel],
    queryFn: () => {
      if (!projectId || !runId)
        throw new Error("projectId and runId are required");
      return api.debug.getRunLogs(projectId, runId, { channel });
    },
    enabled: Boolean(projectId && runId),
    refetchInterval: isRunning ? 2_000 : false,
    staleTime: isRunning ? 0 : 30_000,
  });

  const raw = query.data ?? "";
  const entries = useMemo(() => parseJsonl(raw, channel), [raw, channel]);

  return {
    entries,
    raw,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}
