import { useMemo } from "react";
import {
  keyForProjectSession,
  useIsStreamingByKey,
} from "../../hooks/stream/store";
import type { AnnotatedSession } from "./session-row-utils";

/**
 * Default per-session stream key for `SessionsList` rows: the
 * `useStreamCore` deps shape used by `useChatStream` (project chat).
 * Exported so Phase 4 tests can assert against the same string the
 * per-row indicator subscribes to.
 *
 * Lives in its own module (separate from `SessionsList.tsx`) so the
 * file can export this helper plus the `useIsSessionStreaming` hook
 * without tripping the `react-refresh/only-export-components` rule on
 * the component file.
 */
export function defaultSessionStreamKey(session: AnnotatedSession): string {
  return keyForProjectSession(
    session._projectId,
    session._agentInstanceId,
    session.session_id,
  );
}

/**
 * Per-session streaming-state selector. Reads the stream lane keyed
 * by the supplied resolver (or the project-chat default) so a row of
 * an `AnnotatedSession` lights up exactly when its own client
 * streamKey has an in-flight turn — independent of which session the
 * user is currently viewing in the panel.
 *
 * Pass `resolver` to override the default (e.g. the chat-app left
 * panel passes `keyForAgentSession(agentId, session.session_id)` so
 * the indicator matches the `useAgentChatStream` lane the chat panel
 * actually writes to).
 *
 * Phase 4 frontend tests reuse `keyForProjectSession` /
 * `keyForAgentSession` (exported from
 * `interface/src/hooks/stream/store.ts`) to assert the same key shape.
 */
export function useIsSessionStreaming(
  session: AnnotatedSession,
  resolver?: (session: AnnotatedSession) => string,
): boolean {
  const key = useMemo(
    () => (resolver ? resolver(session) : defaultSessionStreamKey(session)),
    [resolver, session],
  );
  return useIsStreamingByKey(key);
}
