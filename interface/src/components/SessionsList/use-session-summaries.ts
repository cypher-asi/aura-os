import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { isOptimisticSessionId } from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "./session-row-utils";

const MAX_SUMMARY_ATTEMPTS = 3;
const SUMMARY_RETRY_DELAY_MS = 1500;

/**
 * Mirror persisted summaries onto a flat record and lazily summarize
 * sessions that don't have one yet, exactly like the original Chats
 * tab implementation. Lifted into the shared component so the project
 * sidekick gets the same Haiku-summarize behavior for free.
 */
export function useSessionSummaries(
  sessions: AnnotatedSession[],
): Record<string, string> {
  const persistedSummaries = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of sessions) {
      if (s.summary_of_previous_context) {
        out[s.session_id] = s.summary_of_previous_context;
      }
    }
    return out;
  }, [sessions]);

  const [fetchedSummaries, setFetchedSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());
  const attemptsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [retryTick, setRetryTick] = useState(0);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const scheduleRetry = (sessionId: string) => {
      if ((attemptsRef.current[sessionId] ?? 0) >= MAX_SUMMARY_ATTEMPTS) return;
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        setRetryTick((tick) => tick + 1);
      }, SUMMARY_RETRY_DELAY_MS);
      timersRef.current.add(timer);
    };

    for (const session of sessions) {
      // Optimistic placeholder rows ("optimistic:<uuid>") have no
      // server-side identity yet, so `/sessions/<id>/summarize` would
      // round-trip a 400 from axum's UUID-only path extractor and
      // pollute the console. The `replaceSessionId` swap in
      // `useOptimisticSessionRow` will re-render with the real id and
      // re-enter this loop when SessionReady arrives.
      if (isOptimisticSessionId(session.session_id)) continue;
      if (session.summary_of_previous_context) continue;
      if (fetchedSummaries[session.session_id]) continue;
      if (summarizingRef.current.has(session.session_id)) continue;
      if ((attemptsRef.current[session.session_id] ?? 0) >= MAX_SUMMARY_ATTEMPTS) {
        continue;
      }

      // SessionReady can reach the client before the transcript is fully
      // queryable by the summarize endpoint. Keep dedupe scoped to the
      // in-flight request and retry briefly for empty/error responses.
      summarizingRef.current.add(session.session_id);
      attemptsRef.current[session.session_id] =
        (attemptsRef.current[session.session_id] ?? 0) + 1;
      api
        .summarizeSession(session._projectId, session._agentInstanceId, session.session_id)
        .then((updated) => {
          if (updated.summary_of_previous_context) {
            setFetchedSummaries((prev) => ({
              ...prev,
              [session.session_id]: updated.summary_of_previous_context,
            }));
          } else {
            scheduleRetry(session.session_id);
          }
        })
        .catch(() => {
          scheduleRetry(session.session_id);
        })
        .finally(() => {
          summarizingRef.current.delete(session.session_id);
        });
    }
  }, [sessions, fetchedSummaries, retryTick]);

  return useMemo(
    () => ({ ...fetchedSummaries, ...persistedSummaries }),
    [fetchedSummaries, persistedSummaries],
  );
}
