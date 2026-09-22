import { Button, Text } from "@cypher-asi/zui";
import { FolderCode, GitCompare, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ChatsTab } from "../../../apps/agents/AgentInfoPanel/ChatsTab";
import { PanelSearch } from "../../../components/PanelSearch";
import {
  agentSessionsSurfaceKey,
  useMostRecentSession,
} from "../../../stores/sessions-list-store";
import styles from "./MobileAgentResumeSection.module.css";

export function MobileAgentResumeSection({ agentId }: { agentId: string }) {
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const mostRecentSession = useMostRecentSession(agentSessionsSurfaceKey(agentId));
  const queryProjectId = new URLSearchParams(location.search).get("project");
  const queryAgentInstanceId = new URLSearchParams(location.search).get("instance");
  const querySessionId = new URLSearchParams(location.search).get("session");
  const workspaceProjectId = queryProjectId ?? mostRecentSession?._projectId ?? null;
  const workspaceAgentInstanceId = queryAgentInstanceId ?? (
    !queryProjectId || queryProjectId === mostRecentSession?._projectId
      ? mostRecentSession?._agentInstanceId ?? null
      : null
  );
  const workspaceSessionId = querySessionId ?? (
    !queryProjectId || queryProjectId === mostRecentSession?._projectId
      ? mostRecentSession?.session_id ?? null
      : null
  );

  const openChat = () => {
    const params = new URLSearchParams(location.search);
    params.delete("view");
    navigate(`${location.pathname}${params.size > 0 ? `?${params.toString()}` : ""}`);
  };

  const openWorkspace = (view: "files" | "changes") => {
    if (!workspaceProjectId) return;
    const params = new URLSearchParams();
    if (workspaceAgentInstanceId) params.set("instance", workspaceAgentInstanceId);
    params.set("agent", agentId);
    if (workspaceSessionId) params.set("session", workspaceSessionId);
    if (view === "changes") params.set("view", "changes");
    const search = params.size > 0 ? `?${params.toString()}` : "";
    navigate(`/projects/${encodeURIComponent(workspaceProjectId)}/files${search}`);
  };

  return (
    <section className={styles.root} aria-label="Agent activity">
      <div className={styles.header}>
        <div className={styles.copy}>
          <Text size="xs" variant="muted" weight="medium">Cross-device agent</Text>
          <Text size="sm">
            Continue this agent’s shared conversation and inspect the workspace it is using.
          </Text>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={openChat}>
            <MessageSquare size={14} aria-hidden="true" />
            Continue chat
          </Button>
          {workspaceProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openWorkspace("files")}
            >
              <FolderCode size={14} aria-hidden="true" />
              Browse code
            </Button>
          ) : null}
          {workspaceProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openWorkspace("changes")}
            >
              <GitCompare size={14} aria-hidden="true" />
              Review changes
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.recentChats}>
        <Text size="xs" variant="muted" weight="medium">Recent chats</Text>
        <PanelSearch
          placeholder="Search this agent's chats"
          value={sessionSearchQuery}
          onChange={setSessionSearchQuery}
        />
        <ChatsTab showActionButtons searchQuery={sessionSearchQuery} />
      </div>
    </section>
  );
}
