import { useCallback, useMemo, useState } from "react";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AgentList } from "../../../apps/agents/AgentList";
import { useAgents } from "../../../apps/agents/stores";
import { RecallModal } from "../../../apps/chat-app/components/RecallModal/RecallModal";
import type { RecallResultMetadata } from "../../../apps/chat-app/components/RecallModal/RecallModal";
import { PanelSearch } from "../../../components/PanelSearch";
import {
  deriveSessionLabel,
  type AnnotatedSession,
} from "../../../components/SessionsList";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import type { RecallSearchResult } from "../../../shared/api/agents";
import { buildAgentSessionRoute } from "../../../shared/lib/agent-session-route";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import {
  USER_SESSIONS_SURFACE_KEY,
  useSessionsListActions,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import { PendingAgentSends } from "../PendingAgentSends";
import styles from "./MobileAgentLibraryView.module.css";

const EMPTY_SESSIONS: AnnotatedSession[] = [];

export function MobileAgentLibraryView() {
  const { query, setQuery } = useSidebarSearch("agents");
  const navigate = useNavigate();
  const { agents } = useAgents();
  const projects = useProjectsListStore((state) => state.projects);
  const sessions = useSessionsListStore(
    (state) => state.sessionsBySurface[USER_SESSIONS_SURFACE_KEY] ?? EMPTY_SESSIONS,
  );
  const { loadUserSessions } = useSessionsListActions();
  const [recallOpen, setRecallOpen] = useState(false);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.agent_id, agent.name])),
    [agents],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.project_id, project.name])),
    [projects],
  );

  const openRecall = useCallback(() => {
    setRecallOpen(true);
    void loadUserSessions();
  }, [loadUserSessions]);

  const openRecallSource = useCallback((result: RecallSearchResult) => {
    const route = buildAgentSessionRoute({
      projectId: result.projectId,
      agentInstanceId: result.agentInstanceId,
      agentId: result.agentId,
      sessionId: result.sessionId,
    });
    if (!route) return;
    const target = new URL(route, "https://aura.invalid");
    target.searchParams.set("recall_event", result.eventId);
    setRecallOpen(false);
    navigate(`${target.pathname}${target.search}`);
  }, [navigate]);

  const resolveRecallMetadata = useCallback((result: RecallSearchResult): RecallResultMetadata => {
    const session = sessions.find((candidate) => (
      candidate.session_id === result.sessionId &&
      candidate._projectId === result.projectId &&
      candidate._agentInstanceId === result.agentInstanceId
    ));
    return {
      sessionTitle: session
        ? deriveSessionLabel(session, undefined)
        : `Session ${result.sessionId.slice(0, 8)}`,
      projectName: session?._projectName || projectNames.get(result.projectId)
        || `Project ${result.projectId.slice(0, 8)}`,
      agentName: agentNames.get(result.agentId) || `Agent ${result.agentId.slice(0, 8)}`,
    };
  }, [agentNames, projectNames, sessions]);

  return (
    <div className={styles.root}>
      <PendingAgentSends />
      <div className={styles.search}>
        <PanelSearch
          placeholder="Search agents and conversations"
          value={query}
          onChange={setQuery}
        />
        <button type="button" className={styles.recallButton} onClick={openRecall}>
          <History size={16} aria-hidden="true" />
          Search all completed chats
        </button>
      </div>
      <div className={styles.list}>
        <AgentList mode="mobile-library" />
      </div>
      {recallOpen ? (
        <RecallModal
          isOpen
          onClose={() => setRecallOpen(false)}
          onOpenSource={openRecallSource}
          canAddToDraft={false}
          resolveMetadata={resolveRecallMetadata}
          initialQuery={query.trim()}
          showDraftAction={false}
        />
      ) : null}
    </div>
  );
}
