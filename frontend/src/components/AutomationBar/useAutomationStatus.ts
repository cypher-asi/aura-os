import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useEventStore } from "../../stores/event-store";
import { useSidekick } from "../../stores/sidekick-store";
import type { ProjectId } from "../../types";
import { EventType } from "../../types/aura-events";

type AutomationStatus = "idle" | "starting" | "preparing" | "active" | "paused" | "stopped";

interface AutomationStatusData {
  status: AutomationStatus;
  agentCount: number;
  canPlay: boolean;
  canPause: boolean;
  canStop: boolean;
  starting: boolean;
  preparing: boolean;
  confirmStop: boolean;
  setConfirmStop: (v: boolean) => void;
  handleStart: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleStop: () => void;
  handleStopConfirm: () => Promise<void>;
}

export function useAutomationStatus(projectId: ProjectId): AutomationStatusData {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  const { setActiveTab } = useSidekick();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const isForProject = useCallback(
    (event: { project_id?: string }) => event.project_id === projectId,
    [projectId],
  );

  const fetchLoopStatus = useCallback(() => {
    api.getLoopStatus(projectId)
      .then((res) => {
        if (res.active_agent_instances && res.active_agent_instances.length > 0) {
          setActiveAgents(res.active_agent_instances);
          setPaused(res.paused);
          setStarting(false);
        } else {
          setActiveAgents([]); setPaused(false); setStarting(false); setPreparing(false);
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchLoopStatus(); }, [fetchLoopStatus]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) fetchLoopStatus();
    prevConnectedRef.current = connected;
  }, [connected, fetchLoopStatus]);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        // #region agent log
        fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'926b20'},body:JSON.stringify({sessionId:'926b20',location:'useAutomationStatus.ts:LoopStarted',message:'LoopStarted event received',data:{project_id:e.project_id,agent_id:e.agent_id,isForProject:isForProject(e),hookProjectId:projectId},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) setActiveAgents((prev) => prev.includes(agentId) ? prev : [...prev, agentId]);
        setPaused(false); setStarting(false); setPreparing(true);
      }),
      subscribe(EventType.TaskStarted, (e) => {
        // #region agent log
        fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'926b20'},body:JSON.stringify({sessionId:'926b20',location:'useAutomationStatus.ts:TaskStarted',message:'TaskStarted event received',data:{project_id:e.project_id,agent_id:e.agent_id,isForProject:isForProject(e),hookProjectId:projectId},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        if (!isForProject(e)) return; setPreparing(false);
      }),
      subscribe(EventType.LoopPaused, (e) => { if (!isForProject(e)) return; setPaused(true); setPreparing(false); }),
      subscribe(EventType.LoopResumed, (e) => { if (!isForProject(e)) return; setPaused(false); }),
      subscribe(EventType.LoopStopped, (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) setActiveAgents((prev) => prev.filter((id) => id !== agentId));
        else setActiveAgents([]);
        setPaused(false); setStarting(false); setPreparing(false);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        // #region agent log
        fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'926b20'},body:JSON.stringify({sessionId:'926b20',location:'useAutomationStatus.ts:LoopFinished',message:'LoopFinished event received',data:{project_id:e.project_id,agent_id:e.agent_id,isForProject:isForProject(e),hookProjectId:projectId},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) setActiveAgents((prev) => prev.filter((id) => id !== agentId));
        else setActiveAgents([]);
        setPaused(false); setStarting(false); setPreparing(false);
        if (e.content.outcome === "insufficient_credits") dispatchInsufficientCredits();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject]);

  const running = activeAgents.length > 0;

  let status: AutomationStatus = "idle";
  if (starting) status = "starting";
  else if (preparing) status = "preparing";
  else if (paused) status = "paused";
  else if (running) status = "active";

  const handleStart = useCallback(async () => {
    // #region agent log
    fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'926b20'},body:JSON.stringify({sessionId:'926b20',location:'useAutomationStatus.ts:handleStart',message:'handleStart called',data:{projectId,agentInstanceId},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    try {
      setStarting(true); setActiveTab("tasks");
      const res = await api.startLoop(projectId, agentInstanceId);
      // #region agent log
      fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'926b20'},body:JSON.stringify({sessionId:'926b20',location:'useAutomationStatus.ts:handleStart:success',message:'startLoop API succeeded',data:{res},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (res.active_agent_instances) setActiveAgents(res.active_agent_instances);
      setPaused(false); setStarting(false);
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'926b20'},body:JSON.stringify({sessionId:'926b20',location:'useAutomationStatus.ts:handleStart:error',message:'startLoop API FAILED',data:{error:String(err)},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      setStarting(false); setPreparing(false);
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Failed to start loop", err);
    }
  }, [projectId, agentInstanceId, setActiveTab]);

  const handlePause = useCallback(async () => {
    try { await api.pauseLoop(projectId); } catch (err) { console.error("Failed to pause loop", err); }
  }, [projectId]);

  const handleStop = useCallback(() => { setConfirmStop(true); }, []);

  const handleStopConfirm = useCallback(async () => {
    setConfirmStop(false);
    try {
      const res = await api.stopLoop(projectId);
      setActiveAgents(res.active_agent_instances ?? []);
      setPaused(false); setStarting(false);
    } catch (err) { console.error("Failed to stop loop", err); }
  }, [projectId]);

  return {
    status, agentCount: activeAgents.length,
    canPlay: (!running && !paused && !starting) || paused,
    canPause: running && !paused,
    canStop: running || paused,
    starting, preparing, confirmStop, setConfirmStop,
    handleStart, handlePause, handleStop, handleStopConfirm,
  };
}
