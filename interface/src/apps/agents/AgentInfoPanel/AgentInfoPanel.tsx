import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Badge, Button, Modal, Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Bot, Loader2, Calendar, Monitor, Cloud, FolderOpen, X } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { SuperAgentDashboardPanel } from "../../../components/SuperAgentDashboardPanel";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
import { StatusBadge } from "../../../components/StatusBadge";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { api, ApiClientError } from "../../../api/client";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../stores/auth-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { formatTokens } from "../../../utils/format";
import type { Session, Task } from "../../../types";
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
  } = useAgentSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      showEditor: s.showEditor,
      showDeleteConfirm: s.showDeleteConfirm,
      closeEditor: s.closeEditor,
      closeDeleteConfirm: s.closeDeleteConfirm,
      requestEdit: s.requestEdit,
      requestDelete: s.requestDelete,
    })),
  );
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

        {effectiveTab === "processes" && (
          <div className={styles.tabEmptyState}>No processes yet</div>
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

/* ─── Chats Tab (sessions as collapsible items) ─── */

type AnnotatedSession = Session & { _projectName: string; _projectId: string; _agentInstanceId: string };

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function useAgentSessions(
  agentId: string,
  projectBindings: { project_agent_id: string; project_id: string; project_name: string }[],
) {
  const [sessions, setSessions] = useState<AnnotatedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectBindings.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      projectBindings.map((b) =>
        api.listSessions(b.project_id, b.project_agent_id)
          .then((list) =>
            list.map((s) => ({
              ...s,
              _projectName: b.project_name,
              _projectId: b.project_id,
              _agentInstanceId: b.project_agent_id,
            })),
          )
          .catch(() => [] as AnnotatedSession[]),
      ),
    ).then((results) => {
      if (cancelled) return;
      const all = results
        .flat()
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      setSessions(all);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [agentId, projectBindings]);

  return { sessions, loading };
}

function ChatsTab({
  agent,
  projectBindings,
}: {
  agent: import("../../../types").Agent;
  projectBindings: { project_agent_id: string; project_id: string; project_name: string }[];
}) {
  const { sessions, loading } = useAgentSessions(agent.agent_id, projectBindings);
  const taskCacheRef = useRef<Map<string, Task[]>>(new Map());
  const [expandedTasks, setExpandedTasks] = useState<Record<string, Task[]>>({});
  const [loadingTasks, setLoadingTasks] = useState<Set<string>>(new Set());

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const explorerData: ExplorerNode[] = useMemo(
    () =>
      sessions.map((session, index) => {
        const totalTokens = session.total_input_tokens + session.total_output_tokens;
        const tasks = expandedTasks[session.session_id];
        const isLoading = loadingTasks.has(session.session_id);

        const children: ExplorerNode[] = tasks
          ? tasks.map((t) => ({
              id: t.task_id,
              label: t.title,
              icon: <TaskStatusIcon status={t.status} />,
              metadata: { type: "task" },
            }))
          : [{ id: `${session.session_id}__placeholder`, label: isLoading ? "Loading..." : "Expand to see tasks", metadata: { type: "placeholder" } }];

        return {
          id: session.session_id,
          label: `s.${sessions.length - index}`,
          icon: <StatusBadge status={session.status} />,
          suffix: (
            <span className={styles.sessionMeta}>
              <span className={styles.sessionProject}>{session._projectName}</span>
              <span className={styles.sessionDuration}>
                {formatDuration(session.started_at, session.ended_at)}
              </span>
              {totalTokens > 0 && (
                <span className={styles.sessionCost}>
                  {formatTokens(totalTokens)}
                </span>
              )}
            </span>
          ),
          children,
          metadata: { type: "session" },
        };
      }),
    [sessions, expandedTasks, loadingTasks],
  );

  const handleExpand = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (!expanded) return;
      if (taskCacheRef.current.has(nodeId) || loadingTasks.has(nodeId)) return;

      const session = sessionById.get(nodeId);
      if (!session) return;

      setLoadingTasks((prev) => new Set(prev).add(nodeId));

      api
        .listSessionTasks(session._projectId, session._agentInstanceId, session.session_id)
        .then((tasks) => {
          taskCacheRef.current.set(nodeId, tasks);
          setExpandedTasks((prev) => ({ ...prev, [nodeId]: tasks }));
        })
        .catch(() => {
          taskCacheRef.current.set(nodeId, []);
          setExpandedTasks((prev) => ({ ...prev, [nodeId]: [] }));
        })
        .finally(() => {
          setLoadingTasks((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        });
    },
    [sessionById, loadingTasks],
  );

  if (loading) {
    return <div className={styles.tabEmptyState}>Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <div className={styles.sessionListWrap}>
      <Explorer
        data={explorerData}
        enableMultiSelect={false}
        onExpand={handleExpand}
      />
    </div>
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
