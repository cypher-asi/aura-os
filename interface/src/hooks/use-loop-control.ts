import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { useChatUI } from "../stores/chat-ui-store";
import { useAutomationLoopStore } from "../stores/automation-loop-store";
import { projectChatHistoryKey } from "../stores/chat-history-store";
import { EventType, type AuraEvent } from "../shared/types/aura-events";
import { getLastAgent } from "../utils/storage";
import type { ProjectId } from "../shared/types";

interface LoopControlResult {
  loopRunning: boolean;
  loopPaused: boolean;
  error: string;
  handleStart: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleStop: () => Promise<void>;
}

export function useLoopControl(projectId: string | undefined): LoopControlResult {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  // The URL's agentInstanceId reflects the chat surface the user is
  // viewing — useful for the model selector but never the right
  // target for loop control. Loop start / pause / resume / stop
  // always scope to the project's `Loop`-role instance via
  // `boundLoopId` (see below).
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const resolvedAgentInstanceId = agentInstanceId ?? (projectId ? getLastAgent(projectId) : null);
  const streamKey =
    projectId && resolvedAgentInstanceId
      ? projectChatHistoryKey(projectId, resolvedAgentInstanceId)
      : null;
  const { selectedModel } = useChatUI(streamKey ?? "__loop-control__");
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopPaused, setLoopPaused] = useState(false);
  const [error, setError] = useState("");

  // Bound `Loop`-role agent instance id for this project, shared with
  // `useAutomationStatus` so both control surfaces target the same
  // instance and never collide with the chat thread or a parallel
  // ad-hoc task run on the harness "one in-flight turn per agent_id"
  // rule.
  const boundLoopId = useAutomationLoopStore((s) =>
    projectId ? s.loopByProject[projectId] ?? null : null,
  );
  const setBoundLoopId = useAutomationLoopStore((s) => s.setLoopAgent);

  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Hydrate the bound loop id once per project. See
  // `useAutomationStatus` for the same dance.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.listAgentInstances(projectId as ProjectId)
      .then((instances) => {
        if (cancelled) return;
        const loop = instances.find((i) => i.instance_role === "loop");
        setBoundLoopId(projectId as ProjectId, loop?.agent_instance_id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, setBoundLoopId]);

  const fetchStatus = useCallback(() => {
    if (!projectId) return;
    api.getLoopStatus(projectId)
      .then((res) => {
        const active = (res.active_agent_instances?.length ?? 0) > 0;
        setLoopRunning(active);
        setLoopPaused(active && res.paused);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) fetchStatus();
    prevConnectedRef.current = connected;
  }, [connected, fetchStatus]);

  const isForProject = useCallback((e: AuraEvent) => {
    const pid = projectIdRef.current;
    return Boolean(pid && e.project_id === pid);
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (!isForProject(e)) return;
        setLoopRunning(true);
        setLoopPaused(false);
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (!isForProject(e)) return;
        setLoopPaused(true);
      }),
      subscribe(EventType.LoopResumed, (e) => {
        if (!isForProject(e)) return;
        setLoopPaused(false);
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (!isForProject(e)) return;
        setLoopRunning(false);
        setLoopPaused(false);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (!isForProject(e)) return;
        setLoopRunning(false);
        setLoopPaused(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject]);

  const handleStart = useCallback(async () => {
    if (!projectId) return;
    setError("");
    if (loopPaused) {
      try {
        await api.resumeLoop(projectId, boundLoopId ?? undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resume loop");
      }
      return;
    }
    try {
      // Omit `agent_instance_id` so the backend resolves to the
      // project's `Loop`-role instance via
      // `ensure_default_loop_instance`. Capture the resolved id from
      // the response so subsequent pause / resume / stop hit exactly
      // that instance, not the chat thread the user is viewing.
      const res = await api.startLoop(projectId, undefined, selectedModel);
      if (res.agent_instance_id) {
        setBoundLoopId(projectId as ProjectId, res.agent_instance_id);
      }
      setLoopRunning(true);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start loop");
    }
  }, [projectId, loopPaused, boundLoopId, selectedModel, setBoundLoopId]);

  const handlePause = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.pauseLoop(projectId, boundLoopId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause loop");
    }
  }, [projectId, boundLoopId]);

  const handleStop = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.stopLoop(projectId, boundLoopId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop loop");
    }
  }, [projectId, boundLoopId]);

  return { loopRunning, loopPaused, error, handleStart, handlePause, handleStop };
}
