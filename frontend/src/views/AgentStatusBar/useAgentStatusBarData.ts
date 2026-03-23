import { useEffect, useState, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import type { ProjectId, AgentInstance, Session } from "../../types";
import type { AuraEvent } from "../../types/aura-events";
import { EventType } from "../../types/aura-events";
import { api } from "../../api/client";
import { useEventStore } from "../../stores/event-store";
import { useSidekick } from "../../stores/sidekick-store";
import { useClickOutside } from "../../hooks/use-click-outside";

interface AgentEventParams {
  subscribe: ReturnType<typeof useEventStore.getState>["subscribe"];
  projectId: ProjectId;
  isForProject: (event: AuraEvent) => boolean;
  selectedAgent: AgentInstance | null;
  fetchSessions: (agentInstanceId: string) => void;
  setAgents: Dispatch<SetStateAction<AgentInstance[]>>;
  setCurrentTaskTitles: Dispatch<SetStateAction<Record<string, string | null>>>;
}

function useAgentEventSubscriptions({
  subscribe, projectId, isForProject, selectedAgent,
  fetchSessions, setAgents, setCurrentTaskTitles,
}: AgentEventParams): void {
  useEffect(() => {
    const clearTaskTitle = (e: AuraEvent) => {
      if (!isForProject(e)) return;
      const agentId = e.agent_id;
      if (agentId) setCurrentTaskTitles((prev) => ({ ...prev, [agentId]: null }));
    };
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (!isForProject(e)) return;
        api.listAgentInstances(projectId).then(setAgents).catch(console.error);
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId && e.content.task_title) {
          setCurrentTaskTitles((prev) => ({ ...prev, [agentId]: e.content.task_title ?? null }));
        }
      }),
      subscribe(EventType.TaskCompleted, clearTaskTitle),
      subscribe(EventType.TaskFailed, clearTaskTitle),
      subscribe(EventType.SessionRolledOver, (e) => {
        if (!isForProject(e)) return;
        if (selectedAgent) fetchSessions(selectedAgent.agent_instance_id);
      }),
      subscribe(EventType.LoopPaused, clearTaskTitle),
      subscribe(EventType.LoopStopped, clearTaskTitle),
      subscribe(EventType.LoopFinished, clearTaskTitle),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, selectedAgent, fetchSessions, isForProject, projectId, setAgents, setCurrentTaskTitles]);
}

interface AgentStatusBarData {
  connected: boolean;
  agents: AgentInstance[];
  selectedAgent: AgentInstance | null;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  sessions: Session[];
  currentTaskTitle: string | null;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  sessionCount: number;
  handleSessionClick: (session: Session) => void;
}

export function useAgentStatusBarData(projectId: ProjectId): AgentStatusBarData {
  const connected = useEventStore((s) => s.connected);
  const subscribe = useEventStore((s) => s.subscribe);
  const sidekick = useSidekick();
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentTaskTitles, setCurrentTaskTitles] = useState<Record<string, string | null>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

  const selectedAgent = agents.find((a) => a.agent_instance_id === selectedAgentId) ?? agents[0] ?? null;

  const fetchSessions = useCallback((agentInstanceId: string) => {
    api.listSessions(projectId, agentInstanceId).then(setSessions).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    api.listAgentInstances(projectId)
      .then((list) => {
        setAgents(list);
        if (list.length > 0 && !selectedAgentId) {
          setSelectedAgentId(list[0].agent_instance_id);
          fetchSessions(list[0].agent_instance_id);
        }
      })
      .catch(console.error);
  }, [projectId, fetchSessions, selectedAgentId]);

  useEffect(() => {
    if (selectedAgent) fetchSessions(selectedAgent.agent_instance_id);
  }, [selectedAgent?.agent_instance_id, fetchSessions]);

  const isForProject = useCallback(
    (event: AuraEvent) => event.project_id === projectId,
    [projectId],
  );

  useAgentEventSubscriptions({
    subscribe, projectId, isForProject, selectedAgent,
    fetchSessions, setAgents, setCurrentTaskTitles,
  });

  const sessionCount = sessions.length;
  const currentTaskTitle = selectedAgent
    ? currentTaskTitles[selectedAgent.agent_instance_id] ?? null
    : null;

  const handleSessionClick = useCallback((session: Session) => {
    setDropdownOpen(false);
    sidekick.viewSession(session);
  }, [sidekick]);

  return {
    connected, agents, selectedAgent, selectedAgentId, setSelectedAgentId,
    sessions, currentTaskTitle, dropdownOpen, setDropdownOpen, dropdownRef,
    sessionCount, handleSessionClick,
  };
}
