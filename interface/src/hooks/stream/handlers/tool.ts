import type {
  ToolCallStartedInfo,
  ToolCallSnapshotInfo,
  ToolCallInfo,
  ToolResultInfo,
  ToolCallRetryingInfo,
  ToolCallFailedInfo,
} from "../../../api/streams";
import type {
  ToolCallEntry,
  StreamRefs,
  StreamSetters,
} from "../../../shared/types/stream";
import { normalizeToolInput } from "../../../utils/tool-input";
import {
  nextTimelineId,
  pendingToolResult,
  resolvePendingToolCallsInEvents,
  syncDisplayedTimeline,
  type PendingToolResolution,
} from "./shared";

function resolveToolCallInEvents(
  setters: StreamSetters,
  toolCallId: string,
  result: string,
  isError: boolean,
): void {
  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls) return evt;
      const idx = evt.toolCalls.findIndex((tc) => tc.id === toolCallId && tc.pending);
      if (idx === -1) return evt;
      changed = true;
      return {
        ...evt,
        toolCalls: evt.toolCalls.map((tc, i) =>
          i === idx
            ? { ...tc, result, isError, pending: false, started: false }
            : tc,
        ),
      };
    });
    return changed ? next : prev;
  });
}

function appendToolTimelineItem(refs: StreamRefs, setters: StreamSetters, toolCallId: string): void {
  const alreadyInTimeline = refs.timeline.current.some(
    (item) => item.kind === "tool" && item.toolCallId === toolCallId,
  );
  if (!alreadyInTimeline) {
    refs.timeline.current.push({ kind: "tool", toolCallId, id: nextTimelineId() });
    syncDisplayedTimeline(refs, setters);
  }
}

export function handleToolCallStarted(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallStartedInfo,
): void {
  const existingIdx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (existingIdx !== -1) {
    const existing = refs.toolCalls.current[existingIdx];
    if (!existing.started) {
      refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
        i === existingIdx ? { ...tc, started: true, pending: tc.pending ?? true } : tc,
      );
      setters.setActiveToolCalls([...refs.toolCalls.current]);
    }
    return;
  }

  const isSpecTool = info.name === "create_spec" || info.name === "update_spec";
  let initialInput: Record<string, unknown> = {};
  if (isSpecTool) {
    const draftPreview = refs.streamBuffer.current.trim();
    if (draftPreview) initialInput = { draft_preview: draftPreview };
  }

  const entry: ToolCallEntry = {
    id: info.id,
    name: info.name,
    input: initialInput,
    pending: true,
    started: true,
  };
  refs.toolCalls.current = [...refs.toolCalls.current, entry];
  setters.setActiveToolCalls([...refs.toolCalls.current]);
  appendToolTimelineItem(refs, setters, info.id);
}

export function handleToolCallSnapshot(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallSnapshotInfo,
): void {
  const input = normalizeToolInput(info.input);
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx === -1) {
    refs.toolCalls.current = [
      ...refs.toolCalls.current,
      {
        id: info.id,
        name: info.name,
        input,
        pending: true,
        started: true,
      },
    ];
    appendToolTimelineItem(refs, setters, info.id);
    setters.setActiveToolCalls([...refs.toolCalls.current]);
    return;
  }

  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.id === info.id
      ? {
        ...tc,
        name: info.name,
        input: { ...normalizeToolInput(tc.input), ...input },
        retrying: false,
      }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolCallRetrying(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallRetryingInfo,
): void {
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx === -1) {
    refs.toolCalls.current = [
      ...refs.toolCalls.current,
      {
        id: info.id,
        name: info.name,
        input: {},
        pending: true,
        started: true,
        retrying: true,
        retryAttempt: info.attempt,
        retryMax: info.max_attempts,
        retryReason: info.reason,
      },
    ];
    appendToolTimelineItem(refs, setters, info.id);
    setters.setActiveToolCalls([...refs.toolCalls.current]);
    return;
  }

  refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
    i === idx
      ? {
        ...tc,
        retrying: true,
        retryAttempt: info.attempt,
        retryMax: info.max_attempts,
        retryReason: info.reason,
      }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolCallFailed(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallFailedInfo,
): void {
  const reasonText = info.reason?.trim() || "upstream tool call failed";
  const result = `Tool call failed after retries: ${reasonText}`;
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx !== -1) {
    refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
      i === idx
        ? {
          ...tc,
          pending: false,
          started: false,
          isError: true,
          retrying: false,
          retryExhausted: true,
          retryReason: reasonText,
          result,
        }
        : tc,
    );
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  }

  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls) return evt;
      const savedIdx = evt.toolCalls.findIndex((tc) => tc.id === info.id);
      if (savedIdx === -1) return evt;
      changed = true;
      return {
        ...evt,
        toolCalls: evt.toolCalls.map((tc, i) =>
          i === savedIdx
            ? {
                ...tc,
                pending: false,
                started: false,
                isError: true,
                retrying: false,
                retryExhausted: true,
                retryReason: reasonText,
                result,
              }
            : tc,
        ),
      };
    });
    return changed ? next : prev;
  });
}

export function handleToolCall(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallInfo,
): void {
  const input = normalizeToolInput(info.input);
  const existingIdx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (existingIdx !== -1) {
    const existing = refs.toolCalls.current[existingIdx];
    const existingMarkdown = typeof existing.input.markdown_contents === "string"
      ? (existing.input.markdown_contents as string)
      : "";
    const incomingMarkdown = typeof input.markdown_contents === "string"
      ? (input.markdown_contents as string)
      : undefined;
    let mergedMarkdown = existingMarkdown;
    if (incomingMarkdown !== undefined) {
      if (!existingMarkdown || incomingMarkdown.startsWith(existingMarkdown) || incomingMarkdown.length >= existingMarkdown.length) {
        mergedMarkdown = incomingMarkdown;
      } else {
        mergedMarkdown = existingMarkdown + incomingMarkdown;
      }
    }
    const mergedInput: Record<string, unknown> = { ...normalizeToolInput(existing.input), ...input };
    if (incomingMarkdown !== undefined) {
      mergedInput.markdown_contents = mergedMarkdown;
    }
    refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
      tc.id === info.id
        ? { ...tc, name: info.name, input: mergedInput, started: false }
        : tc,
    );
  } else {
    const entry: ToolCallEntry = {
      id: info.id,
      name: info.name,
      input,
      pending: true,
    };
    refs.toolCalls.current = [...refs.toolCalls.current, entry];
    appendToolTimelineItem(refs, setters, info.id);
  }
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolResult(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolResultInfo,
): void {
  let targetIndex = -1;
  if (info.id) {
    targetIndex = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  } else {
    for (let i = refs.toolCalls.current.length - 1; i >= 0; i--) {
      const tc = refs.toolCalls.current[i];
      if (tc.pending && tc.name === info.name) {
        targetIndex = i;
        break;
      }
    }
  }

  let resolvedId: string | undefined;
  if (targetIndex !== -1) {
    resolvedId = refs.toolCalls.current[targetIndex].id;
    refs.toolCalls.current = refs.toolCalls.current.map((tc, idx) =>
      idx === targetIndex
        ? {
            ...tc,
            result: info.result,
            isError: info.is_error,
            pending: false,
            started: false,
            retrying: false,
          }
        : tc,
    );
  }
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  if (resolvedId) {
    resolveToolCallInEvents(setters, resolvedId, info.result, info.is_error);
  }
}

export function resolvePendingToolCalls(
  refs: StreamRefs,
  setters: StreamSetters,
  resolution: PendingToolResolution,
): void {
  const hasPending = refs.toolCalls.current.some((tc) => tc.pending);
  if (!hasPending) {
    resolvePendingToolCallsInEvents(setters, resolution);
    return;
  }
  refs.toolCalls.current = refs.toolCalls.current.map((tc) => {
    const result = pendingToolResult(tc, resolution);
    return tc.pending
      ? {
          ...tc,
          pending: false,
          started: false,
          isError: resolution.isError,
          ...(result !== undefined ? { result } : {}),
        }
      : tc;
  });
  resolvePendingToolCallsInEvents(setters, resolution);
}

export function resolveAbandonedPendingToolCalls(
  refs: StreamRefs,
  setters: StreamSetters,
  reason: string,
): void {
  const trimmed = reason.trim();
  const result = trimmed
    ? `Interrupted by upstream error: ${trimmed}`
    : "Interrupted by upstream error before result was received";
  const resolution: PendingToolResolution = { isError: true, result };
  const hasPending = refs.toolCalls.current.some((tc) => tc.pending);
  if (hasPending) {
    refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
      tc.pending
        ? {
            ...tc,
            pending: false,
            started: false,
            isError: true,
            result,
          }
        : tc,
    );
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  }
  resolvePendingToolCallsInEvents(setters, resolution);
}
