import { Button, Text } from "@cypher-asi/zui";
import { FolderCode, MessageSquare } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { ChatsTab } from "../../../apps/agents/AgentInfoPanel/ChatsTab";
import {
  agentSessionsSurfaceKey,
  useMostRecentSession,
} from "../../../stores/sessions-list-store";
import styles from "./MobileAgentResumeSection.module.css";

export function MobileAgentResumeSection({ agentId }: { agentId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const mostRecentSession = useMostRecentSession(agentSessionsSurfaceKey(agentId));
  const queryProjectId = new URLSearchParams(location.search).get("project");
  const workspaceProjectId = queryProjectId ?? mostRecentSession?._projectId ?? null;

  const openChat = () => {
    const params = new URLSearchParams(location.search);
    params.delete("view");
    navigate(`${location.pathname}${params.size > 0 ? `?${params.toString()}` : ""}`);
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
              onClick={() => navigate(`/projects/${workspaceProjectId}/files`)}
            >
              <FolderCode size={14} aria-hidden="true" />
              Browse code
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.recentChats}>
        <Text size="xs" variant="muted" weight="medium">Recent chats</Text>
        <ChatsTab />
      </div>
    </section>
  );
}
