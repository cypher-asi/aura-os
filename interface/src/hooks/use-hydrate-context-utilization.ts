import { useEffect } from "react";
import { useContextUsageStore } from "../stores/context-usage-store";
import { useIsStreaming } from "./stream/hooks";

export interface HydrateContextUtilizationFetcher {
  (signal: AbortSignal): Promise<{
    context_utilization: number;
    estimated_context_tokens?: number;
  }>;
}

/**
 * Seeds {@link useContextUsageStore} once per chat-view mount using the
 * latest session's `context_usage_estimate`. Without this hydration the
 * bottom-left context indicator in {@link ChatInputBar} only appears after
 * the first `AssistantMessageEnd` event of a new stream, because the store
 * is otherwise only populated by the streaming code path.
 *
 * Guards (must be preserved — see the `plan.md` under
 * `hydrate-context-on-chat-open`):
 *
 * - `resetKey` (typically the agent id) drives the effect so the fetch only
 *   fires on mount / agent switch, never on every render.
 * - If the user has clicked "New session" (`markResetPending` was called for
 *   this `streamKey`), the hook skips hydration entirely. The reset sentinel
 *   is cleared automatically when the next stream turn's
 *   `setContextUtilization` fires, so the indicator re-enables naturally.
 * - If a streaming turn is in flight, skip — a live `AssistantMessageEnd`
 *   must take precedence.
 * - If the store already has a value for this `streamKey`, skip — it's
 *   already fresher than anything storage could return.
 * - Values of `0` are not written to the store; the indicator's `> 0`
 *   guard would hide them anyway, and writing a literal `0` could mask the
 *   "no value yet" state for downstream consumers.
 *
 * The hook no-ops when `resetKey` or `fetcher` is `undefined` (e.g. session
 * detail views that intentionally hide the indicator).
 */
export function useHydrateContextUtilization(
  streamKey: string,
  fetcher: HydrateContextUtilizationFetcher | undefined,
  resetKey: string | undefined,
): void {
  const isStreaming = useIsStreaming(streamKey);

  useEffect(() => {
    if (!resetKey || !fetcher) return;

    const state = useContextUsageStore.getState();
    if (state.isResetPending(streamKey)) return;
    if (state.usageByStreamKey[streamKey] != null) return;
    if (isStreaming) return;

    const controller = new AbortController();
    let cancelled = false;

    fetcher(controller.signal)
      .then((response) => {
        if (cancelled) return;
        const latest = useContextUsageStore.getState();
        if (latest.isResetPending(streamKey)) return;
        if (latest.usageByStreamKey[streamKey] != null) return;
        if (
          typeof response.context_utilization !== "number" ||
          !Number.isFinite(response.context_utilization) ||
          response.context_utilization <= 0
        ) {
          return;
        }
        latest.setContextUtilization(
          streamKey,
          response.context_utilization,
          response.estimated_context_tokens,
        );
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        console.warn("Failed to hydrate initial context utilization", err);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `isStreaming` is intentionally excluded from deps: the guard above
    // reads the current value and we don't want re-running when a stream
    // starts/ends — the stream handler already updates the store directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, fetcher, resetKey]);
}
