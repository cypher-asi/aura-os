import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Badge, Button, Modal } from "@cypher-asi/zui";
import { Bot, Loader2, Calendar, Monitor, Cloud, FolderOpen, MessageSquare, X } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { SuperAgentDashboardPanel } from "../../../components/SuperAgentDashboardPanel";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
import { api, ApiClientError } from "../../../api/client";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAgentSidekick } from "../stores/agent-sidekick-store";
import { useAuth } from "../../../stores/auth-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useChatHistoryStore, agentHistoryKey } from "../../../stores/chat-history-store";
import { formatChatTime } from "../../../utils/format";
import styles from "./AgentInfoPanel.module.css";

interface AgentInfoPanelProps {
  variant?: "default" | "mobileStandalone";
}

export function AgentInfoPanel({ variant = "default" }: AgentInfoPanelProps) {
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    activeTab,
    showEditor,
    showDeleteConfirm,
    closeEditor,
    closeDeleteConfirm,
    requestEdit,
    requestDelete,
  } = useAgentSidekick();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  const [projectBindings, setProjectBindings] = useState<
    { project_agent_id: string; project_id: string; project_name: string }[]
  >([]);

  useEffect(() => {
    setIconFailed(false);
    if (selectedAgent) {
      api.agents.listProjectBindings(selectedAgent.agent_id)
        .then(setProjectBindings)
        .catch(() => setProjectBindings([]));
    }
  }, [selectedAgent?.agent_id]);

  // Prefetch direct chat history for the chats tab
  useEffect(() => {
    if (selectedAgent) {
      const key = agentHistoryKey(selectedAgent.agent_id);
      useChatHistoryStore.getState().prefetchHistory(
        key,
        () => api.agents.listEvents(selectedAgent.agent_id),
      );
    }
  }, [selectedAgent?.agent_id]);

  const openDeleteConfirm = useCallback(() => {
    setDeleteError(null);
    requestDelete();
  }, [requestDelete]);

  const handleCloseDeleteConfirm = useCallback(() => {
    closeDeleteConfirm();
    setDeleteError(null);
  }, [closeDeleteConfirm]);

  const handleDelete = useCallback(async () => {
    if (!selectedAgent) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.agents.delete(selectedAgent.agent_id);
      handleCloseDeleteConfirm();
      setSelectedAgent(null);
      useAgentStore.getState().fetchAgents({ force: true });
      navigate("/agents");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDeleteError(err.body.error);
      } else {
        setDeleteError("Failed to delete agent.");
      }
    } finally {
      setDeleting(false);
    }
  }, [selectedAgent, setSelectedAgent, navigate, handleCloseDeleteConfirm]);

  if (!selectedAgent) {
    return (
      <EmptyState>Select an agent to see details</EmptyState>
    );
  }

  const a = selectedAgent;
  const imageUrl = a.icon && !iconFailed ? a.icon : undefined;
  const isOwnAgent = !!user?.network_user_id && user.network_user_id === a.user_id;
  const isMobileStandalone = variant === "mobileStandalone";

  const effectiveTab = isMobileStandalone ? "profile" : activeTab;

  return (
    <div className={styles.wrapper}>
      <div className={styles.scrollArea}>
        {effectiveTab === "profile" && (
          <ProfileTab
            agent={a}
            imageUrl={imageUrl}
            isOwnAgent={isOwnAgent}
            onIconError={() => setIconFailed(true)}
          />
        )}

        {effectiveTab === "chats" && (
          <ChatsTab
            agent={a}
            projectBindings={projectBindings}
            navigate={navigate}
          />
        )}

        {effectiveTab === "skills" && (
          <SkillsTab agent={a} />
        )}

        {effectiveTab === "projects" && (
          <ProjectsTab
            agent={a}
            projectBindings={projectBindings}
            setProjectBindings={setProjectBindings}
            isOwnAgent={isOwnAgent}
          />
        )}

        {effectiveTab === "tasks" && (
          <div className={styles.tabEmptyState}>No tasks yet</div>
        )}

        {effectiveTab === "crons" && (
          <div className={styles.tabEmptyState}>No crons yet</div>
        )}

        {effectiveTab === "logs" && (
          <div className={styles.tabEmptyState}>No logs yet</div>
        )}

        {effectiveTab === "stats" && (
          <div className={styles.tabEmptyState}>No stats yet</div>
        )}

        {effectiveTab === "profile" && a.tags?.includes("super_agent") && (
          <SuperAgentDashboardPanel agent={a} />
        )}
      </div>

      {isMobileStandalone && isOwnAgent && (
        <div className={styles.mobileActions}>
          <Button variant="ghost" size="sm" onClick={requestEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={openDeleteConfirm}>
            Delete
          </Button>
        </div>
      )}

      <AgentEditorModal
        isOpen={showEditor}
        agent={selectedAgent ?? undefined}
        onClose={closeEditor}
        onSaved={(updated) => {
          useAgentStore.getState().patchAgent(updated);
          useProjectsListStore.getState().patchAgentTemplateFields(updated);
          setSelectedAgent(updated.agent_id);
          useAgentStore.getState().fetchAgents({ force: true });
        }}
      />

      <Modal
        isOpen={showDeleteConfirm}
        onClose={handleCloseDeleteConfirm}
        title="Delete Agent"
        size="sm"
        footer={
          <div className={styles.deleteFooter}>
            <Button variant="ghost" onClick={handleCloseDeleteConfirm} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 size={14} className={styles.spin} /> Deleting...</> : "Delete"}
            </Button>
          </div>
        }
      >
        <Text size="sm">
          Are you sure you want to delete <strong>{a.name}</strong>? This cannot be undone.
        </Text>
        {deleteError && (
          <Text size="xs" className={styles.deleteError}>
            {deleteError}
          </Text>
        )}
      </Modal>
    </div>
  );
}

/* ─── Profile Tab ─── */

function ProfileTab({
  agent: a,
  imageUrl,
  isOwnAgent,
  onIconError,
}: {
  agent: import("../../../types").Agent;
  imageUrl: string | undefined;
  isOwnAgent: boolean;
  onIconError: () => void;
}) {
  return (
    <>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className={styles.hidden}
          onError={onIconError}
        />
      )}

      <div className={styles.profileImageBlock}>
        {imageUrl ? (
          <img src={imageUrl} alt={a.name} className={styles.profileImage} onError={onIconError} />
        ) : (
          <Bot size={48} />
        )}
      </div>

      <div className={styles.nameBlock}>
        <div className={styles.nameText}>
          <span className={styles.displayName}>{a.name}</span>
          {a.role && <span className={styles.subtitle}>{a.role}</span>}
        </div>
        {!isOwnAgent && (
          <div className={styles.nameAction}>
            <FollowEditButton
              isOwner={false}
              targetProfileId={a.profile_id}
            />
          </div>
        )}
      </div>

      {a.tags?.includes("super_agent") && (
        <div className={styles.section}>
          <Badge variant="running">CEO SuperAgent</Badge>
        </div>
      )}

      {a.personality && (
        <div className={styles.section}>
          <Text size="xs" variant="muted" weight="medium">Personality</Text>
          <Text size="sm">{a.personality}</Text>
        </div>
      )}

      <div className={styles.metaGrid}>
        <div className={styles.metaRow}>
          {a.machine_type === "remote" ? (
            <Cloud size={13} className={styles.metaIcon} />
          ) : (
            <Monitor size={13} className={styles.metaIcon} />
          )}
          <span className={styles.metaValue}>
            {a.machine_type === "remote" ? "Remote Machine" : "Local Machine"}
          </span>
        </div>
        <div className={styles.metaRow}>
          <Calendar size={13} className={styles.metaIcon} />
          <span className={styles.metaValue}>
            Birthed {new Date(a.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
        </div>
      </div>

      {a.system_prompt && (
        <div className={styles.section}>
          <Text size="xs" variant="muted" weight="medium">System Prompt</Text>
          <Text size="sm" className={styles.prompt}>
            {a.system_prompt}
          </Text>
        </div>
      )}
    </>
  );
}

/* ─── Chats Tab ─── */

function ChatsTab({
  agent,
  projectBindings,
  navigate,
}: {
  agent: import("../../../types").Agent;
  projectBindings: { project_agent_id: string; project_id: string; project_name: string }[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const directKey = agentHistoryKey(agent.agent_id);
  const directEntry = useChatHistoryStore((s) => s.entries[directKey]);
  const directLastMsg = directEntry?.events?.length
    ? directEntry.events[directEntry.events.length - 1]
    : undefined;

  return (
    <>
      <button
        type="button"
        className={styles.chatRow}
        onClick={() => navigate(`/agents/${agent.agent_id}`)}
      >
        <span className={styles.chatIcon}>
          <MessageSquare size={16} />
        </span>
        <span className={styles.chatBody}>
          <span className={styles.chatTitle}>Direct Chat</span>
          <span className={styles.chatPreview}>
            {directLastMsg
              ? `${directLastMsg.role === "user" ? "You: " : ""}${directLastMsg.content}`.slice(0, 80)
              : "Start a conversation"}
          </span>
        </span>
        {directEntry?.lastMessageAt && (
          <span className={styles.chatTime}>
            {formatChatTime(directEntry.lastMessageAt)}
          </span>
        )}
      </button>

      {projectBindings.map((b) => (
        <button
          key={b.project_agent_id}
          type="button"
          className={styles.chatRow}
          onClick={() => navigate(`/projects/${b.project_id}/agents/${b.project_agent_id}`)}
        >
          <span className={styles.chatIcon}>
            <FolderOpen size={16} />
          </span>
          <span className={styles.chatBody}>
            <span className={styles.chatTitle}>{b.project_name}</span>
            <span className={styles.chatPreview}>Project conversation</span>
          </span>
        </button>
      ))}

      {projectBindings.length === 0 && !directLastMsg && (
        <div className={styles.tabEmptyState}>No conversations yet</div>
      )}
    </>
  );
}

/* ─── Skills Tab ─── */

function SkillsTab({ agent: a }: { agent: import("../../../types").Agent }) {
  if (a.skills.length === 0) {
    return <div className={styles.tabEmptyState}>No skills configured</div>;
  }

  return (
    <div className={styles.section}>
      <Text size="xs" variant="muted" weight="medium">Skills</Text>
      <div className={styles.skills}>
        {a.skills.map((s) => (
          <Badge key={s} variant="pending" className={styles.skillBadge}>{s}</Badge>
        ))}
      </div>
    </div>
  );
}

/* ─── Projects Tab ─── */

function ProjectsTab({
  agent: a,
  projectBindings,
  setProjectBindings,
  isOwnAgent,
}: {
  agent: import("../../../types").Agent;
  projectBindings: { project_agent_id: string; project_id: string; project_name: string }[];
  setProjectBindings: React.Dispatch<React.SetStateAction<typeof projectBindings>>;
  isOwnAgent: boolean;
}) {
  if (projectBindings.length === 0) {
    return <div className={styles.tabEmptyState}>Not added to any projects</div>;
  }

  return (
    <div className={styles.section}>
      <Text size="xs" variant="muted" weight="medium">Added to Projects</Text>
      <div className={styles.bindingsList}>
        {projectBindings.map((b) => (
          <div key={b.project_agent_id} className={styles.bindingRow}>
            <FolderOpen size={12} className={styles.metaIcon} />
            <Text size="xs" className={styles.bindingName}>{b.project_name}</Text>
            {isOwnAgent && (
              <button
                type="button"
                className={styles.removeBinding}
                title="Remove from project"
                onClick={async () => {
                  try {
                    await api.agents.removeProjectBinding(a.agent_id, b.project_agent_id);
                    setProjectBindings((prev) =>
                      prev.filter((p) => p.project_agent_id !== b.project_agent_id),
                    );
                  } catch { /* ignore */ }
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
