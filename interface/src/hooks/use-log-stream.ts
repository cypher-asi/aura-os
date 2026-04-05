import React, { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { useEventStore } from "../stores/event-store";
import type { AuraEvent } from "../types/aura-events";
import { EventType } from "../types/aura-events";
import { formatTime } from "../utils/format";
import { LOG_MAX_LINES } from "../constants";
import { api } from "../api/client";
import { summarise } from "./use-log-stream-utils";

export { EVENT_LABELS } from "./use-log-stream-labels";

export interface LogEntry {
  timestamp: string;
  type: EventType;
  summary: string;
  detail: AuraEvent;
}

interface UseLogStreamResult {
  entries: LogEntry[];
  contentRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  connected: boolean;
}

const ALL_ENGINE_EVENT_TYPES: EventType[] = [
  EventType.LoopStarted, EventType.LoopPaused, EventType.LoopStopped,
  EventType.LoopFinished, EventType.LoopIterationSummary,
  EventType.TaskStarted, EventType.TaskCompleted, EventType.TaskFailed,
  EventType.TaskRetrying, EventType.TaskBecameReady, EventType.TasksBecameReady,
  EventType.FileOpsApplied, EventType.FollowUpTaskCreated,
  EventType.SessionRolledOver, EventType.LogLine,
  EventType.SpecGenStarted, EventType.SpecGenProgress,
  EventType.SpecGenCompleted, EventType.SpecGenFailed, EventType.SpecSaved,
  EventType.BuildVerificationSkipped, EventType.BuildVerificationStarted,
  EventType.BuildVerificationPassed, EventType.BuildVerificationFailed,
  EventType.BuildFixAttempt,
  EventType.TestVerificationStarted, EventType.TestVerificationPassed,
  EventType.TestVerificationFailed, EventType.TestFixAttempt,
  EventType.GitCommitted, EventType.GitCommitFailed, EventType.GitPushed, EventType.GitPushFailed, EventType.NetworkEvent,
  EventType.Error,
];

function eventToLogEntry(event: AuraEvent, ts?: Date): LogEntry {
  return {
    timestamp: formatTime(ts ?? new Date()),
    type: event.type,
    summary: summarise(event),
    detail: event,
  };
}

function mergeEntries(restored: LogEntry[], prev: LogEntry[]): LogEntry[] {
  const combined = [...restored, ...prev];
  return combined.length > LOG_MAX_LINES ? combined.slice(-LOG_MAX_LINES) : combined;
}

function useLogHistory(setEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>): void {
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    api.getLogEntries(LOG_MAX_LINES).then((persisted) => {
      if (persisted.length === 0) return;
      const restored = persisted.map((p) => eventToLogEntry(p.event as unknown as AuraEvent, new Date(p.timestamp_ms)));
      setEntries((prev) => mergeEntries(restored, prev));
    }).catch(() => {});

    return () => { historyLoadedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function useLogSubscription(
  setEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>,
): void {
  const subscribe = useEventStore((s) => s.subscribe);

  const addEntry = useCallback((event: AuraEvent) => {
    setEntries((prev) => {
      const next = [...prev, eventToLogEntry(event)];
      return next.length > LOG_MAX_LINES ? next.slice(-LOG_MAX_LINES) : next;
    });
  }, [setEntries]);

  useEffect(() => {
    const unsubs = ALL_ENGINE_EVENT_TYPES.map((type) => subscribe(type, (e) => addEntry(e)));
    return () => unsubs.forEach((u) => u());
  }, [subscribe, addEntry]);
}

function useAutoScroll(
  entries: LogEntry[],
  contentRef: RefObject<HTMLDivElement | null>,
): () => void {
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [entries, contentRef]);

  return useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, [contentRef]);
}

export function useLogStream(): UseLogStreamResult {
  const connected = useEventStore((s) => s.connected);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  useLogHistory(setEntries);
  useLogSubscription(setEntries);
  const handleScroll = useAutoScroll(entries, contentRef);

  return { entries, contentRef, handleScroll, connected };
}
