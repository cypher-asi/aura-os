import { useEffect, useRef, useState } from "react";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";

export interface CooldownState {
  /** `true` while a `loop_paused` cooldown window is active. */
  paused: boolean;
  /**
   * Seconds remaining in the cooldown window. Counts down once per
   * second while `paused` is `true`. `null` when no `cooldown_ms` hint
   * was provided on the pause event.
   */
  remainingSeconds: number | null;
  /** Classified infra-failure kind from the backend. */
  retryKind: string | null;
  /** Human-readable reason string from the backend. */
  reason: string | null;
  /** Task id associated with the pause, if any. */
  taskId: string | null;
}

const EMPTY: CooldownState = {
  paused: false,
  remainingSeconds: null,
  retryKind: null,
  reason: null,
  taskId: null,
};

/**
 * Track project/agent cooldown state driven by `loop_paused` /
 * `loop_resumed` domain events. Used by `TaskOutputSection` and friends
 * to distinguish "agent is still working, no output yet" from "agent is
 * rate-limited, backing off for N seconds" — the backend already knows
 * the difference via `retry_after_ms` + `InfraFailureClass`, and emits
 * it on `loop_paused` with `cooldown_ms` and `retry_kind`.
 */
export function useCooldownStatus(
  agentInstanceId?: string,
  projectId?: string,
): CooldownState {
  const subscribe = useEventStore((s) => s.subscribe);
  const [state, setState] = useState<CooldownState>(EMPTY);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const matches = (eventAgent?: string, eventProject?: string) => {
    if (agentInstanceId && eventAgent && eventAgent !== agentInstanceId) {
      return false;
    }
    if (projectId && eventProject && eventProject !== projectId) {
      return false;
    }
    return true;
  };

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.LoopPaused, (e) => {
        const content = e.content;
        const eventAgent = e.agent_id || undefined;
        const eventProject = e.project_id || undefined;
        if (!matches(eventAgent, eventProject)) return;
        const cooldownMs = content.cooldown_ms;
        const remaining =
          typeof cooldownMs === "number" && cooldownMs > 0
            ? Math.ceil(cooldownMs / 1000)
            : null;
        setState({
          paused: true,
          remainingSeconds: remaining,
          retryKind: content.retry_kind ?? null,
          reason: content.reason ?? null,
          taskId: content.task_id ?? null,
        });
        clearTick();
        if (remaining !== null) {
          tickRef.current = setInterval(() => {
            setState((prev) => {
              if (!prev.paused || prev.remainingSeconds == null) return prev;
              const next = prev.remainingSeconds - 1;
              return { ...prev, remainingSeconds: next > 0 ? next : 0 };
            });
          }, 1000);
        }
      }),
      subscribe(EventType.LoopResumed, (e) => {
        const eventAgent = e.agent_id || undefined;
        const eventProject = e.project_id || undefined;
        if (!matches(eventAgent, eventProject)) return;
        clearTick();
        setState(EMPTY);
      }),
      subscribe(EventType.LoopStopped, (e) => {
        const eventProject = e.project_id || undefined;
        if (projectId && eventProject && eventProject !== projectId) return;
        clearTick();
        setState(EMPTY);
      }),
    ];
    return () => {
      unsubs.forEach((u) => u());
      clearTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, agentInstanceId, projectId]);

  return state;
}

/**
 * Map an `InfraFailureClass` string from the backend to a short
 * user-facing label. Falls back to the raw value when unknown so
 * future additions still render something useful.
 */
export function cooldownLabel(retryKind: string | null): string {
  switch (retryKind) {
    case "provider_rate_limited":
      return "Rate limited by provider";
    case "provider_overloaded":
      return "Provider overloaded";
    case "transport_timeout":
      return "Network timeout";
    case "git_timeout":
      return "Git operation timed out";
    case null:
      return "Paused";
    default:
      return retryKind;
  }
}
