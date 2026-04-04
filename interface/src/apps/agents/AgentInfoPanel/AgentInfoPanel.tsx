import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Badge, Button, Modal } from "@cypher-asi/zui";
import { Bot, Loader2, Calendar, Monitor, Cloud, FolderOpen, X, ChevronRight, ChevronDown, Zap } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { SuperAgentDashboardPanel } from "../../../components/SuperAgentDashboardPanel";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
import { PreviewOverlay } from "../../../components/PreviewOverlay";
import { StatusBadge } from "../../../components/StatusBadge";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { api, ApiClientError } from "../../../api/client";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../stores/auth-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { formatTokens } from "../../../utils/format";
import { SkillsTab } from "./SkillsTab";
import { MemoryTab } from "./MemoryTab";
import { SkillPreview } from "./SkillPreview";
import { FactPreview, EventPreview, ProcedurePreview } from "./MemoryPreview";
import type { Session, Task, HarnessSkillInstallation } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

interface AgentInfoPanelProps {
  variant?: "default" | "mobileStandalone";
}

function formatAdapterLabel(adapterType?: string | null): string {
  switch (adapterType) {
    case "claude_code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "aura_harness":
    default:
      return "Aura";
  }
}

function formatAuthSourceLabel(authSource?: string | null): string {
  switch (authSource) {
    case "org_integration":
      return "Team Integration";
    case "local_cli_auth":
      return "Local Login";
    case "aura_managed":
    default:
      return "Aura Billing";
  }
}

function formatRunsOnLabel(environment?: string | null, machineType?: string | null): string {
  const effective = environment || (machineType === "remote" ? "swarm_microvm" : "local_host");
  switch (effective) {
    case "swarm_microvm":
      return "Isolated Cloud Runtime";
    case "local_host":
    default:
      return "This Machine";
  }
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
    previewItem,
    canGoBack,
    goBackPreview,
    closePreview,
  } = useAgentSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      showEditor: s.showEditor,
      showDeleteConfirm: s.showDeleteConfirm,
      closeEditor: s.closeEditor,
      closeDeleteConfirm: s.closeDeleteConfirm,
      requestEdit: s.requestEdit,
      requestDelete: s.requestDelete,
      previewItem: s.previewItem,
      canGoBack: s.canGoBack,
      goBackPreview: s.goBackPreview,
      closePreview: s.closePreview,
    })),
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  const [runtimeTesting, setRuntimeTesting] = useState(false);
  const [runtimeTestMessage, setRuntimeTestMessage] = useState<string | null>(null);
  const [runtimeTestStatus, setRuntimeTestStatus] = useState<"success" | "error" | null>(null);
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

  const handleRuntimeTest = useCallback(async () => {
    if (!selectedAgent) return;
    setRuntimeTesting(true);
    setRuntimeTestMessage(null);
    setRuntimeTestStatus(null);
    try {
      const result = await api.agents.testRuntime(selectedAgent.agent_id);
      setRuntimeTestMessage(result.message || "Runtime test passed.");
      setRuntimeTestStatus("success");
    } catch (err) {
      setRuntimeTestMessage(err instanceof Error ? err.message : "Runtime test failed.");
      setRuntimeTestStatus("error");
    } finally {
      setRuntimeTesting(false);
    }
  }, [selectedAgent]);

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
            runtimeTesting={runtimeTesting}
            runtimeTestMessage={runtimeTestMessage}
            runtimeTestStatus={runtimeTestStatus}
            onRuntimeTest={handleRuntimeTest}
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

        {effectiveTab === "memory" && (
          <MemoryTab agent={a} />
        )}

        {effectiveTab === "stats" && (
          <div className={styles.tabEmptyState}>No stats yet</div>
        )}

        {effectiveTab === "profile" && a.tags?.includes("super_agent") && (
          <SuperAgentDashboardPanel agent={a} />
        )}
      </div>

      {previewItem && (
        <PreviewOverlay
          title={
            previewItem.kind === "skill" ? previewItem.skill.name
            : previewItem.kind === "memory_fact" ? `Fact: ${previewItem.fact.key}`
            : previewItem.kind === "memory_event" ? `Event: ${previewItem.event.event_type}`
            : `Procedure: ${previewItem.procedure.name}`
          }
          canGoBack={canGoBack}
          onBack={goBackPreview}
          onClose={closePreview}
          fullLane
        >
          {previewItem.kind === "skill" && <SkillPreview skill={previewItem.skill} installation={previewItem.installation} />}
          {previewItem.kind === "memory_fact" && <FactPreview fact={previewItem.fact} />}
          {previewItem.kind === "memory_event" && <EventPreview event={previewItem.event} />}
          {previewItem.kind === "memory_procedure" && <ProcedurePreview procedure={previewItem.procedure} />}
        </PreviewOverlay>
      )}

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
  runtimeTesting,
  runtimeTestMessage,
  runtimeTestStatus,
  onRuntimeTest,
}: {
  agent: import("../../../types").Agent;
  imageUrl: string | undefined;
  isOwnAgent: boolean;
  onIconError: () => void;
  runtimeTesting: boolean;
  runtimeTestMessage: string | null;
  runtimeTestStatus: "success" | "error" | null;
  onRuntimeTest: () => void;
}) {
  const [installations, setInstallations] = useState<HarnessSkillInstallation[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.harnessSkills
      .listAgentSkills(a.agent_id)
      .then((result) => {
        if (cancelled) return;
        const list = Array.isArray(result) ? result : (result as any)?.skills ?? (result as any)?.installations ?? [];
        setInstallations(list);
      })
      .catch(() => {
        if (!cancelled) setInstallations([]);
      });
    return () => { cancelled = true; };
  }, [a.agent_id]);

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
            {a.machine_type === "remote" ? "Cloud Runtime" : "This Machine"}
          </span>
        </div>
        <div className={styles.metaRow}>
          <Bot size={13} className={styles.metaIcon} />
          <span className={styles.metaValue}>{formatAdapterLabel(a.adapter_type)}</span>
        </div>
        <div className={styles.metaRow}>
          <FolderOpen size={13} className={styles.metaIcon} />
          <span className={styles.metaValue}>
            {formatAuthSourceLabel(a.auth_source)}
            {a.integration_id ? " • team integration attached" : ""}
          </span>
        </div>
        <div className={styles.metaRow}>
          <Calendar size={13} className={styles.metaIcon} />
          <span className={styles.metaValue}>
            Birthed {new Date(a.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
        </div>
      </div>

      <div className={styles.section}>
        <Text size="xs" variant="muted" weight="medium">Runtime</Text>
        <Text size="sm">
          Runtime: {formatAdapterLabel(a.adapter_type)} • Runs On: {formatRunsOnLabel(a.environment, a.machine_type)} • Authentication: {formatAuthSourceLabel(a.auth_source)}
        </Text>
        <div className={styles.nameAction} style={{ marginTop: 8 }}>
          <Button variant="secondary" size="sm" onClick={onRuntimeTest} disabled={runtimeTesting}>
            {runtimeTesting ? "Checking..." : "Check Runtime"}
          </Button>
        </div>
        {runtimeTestMessage && (
          <div
            className={`${styles.runtimeTestResult} ${
              runtimeTestStatus === "error" ? styles.runtimeTestError : styles.runtimeTestSuccess
            }`}
            aria-live="polite"
          >
            <Text size="xs" variant="muted">{runtimeTestMessage}</Text>
          </div>
        )}
      </div>
      {installations.length > 0 && (
        <div className={styles.skillTagsSection}>
          {installations.map((inst) => (
            <span key={inst.skill_name} className={styles.skillTag}>
              <Zap size={10} className={styles.skillTagIcon} />
              {inst.skill_name}
            </span>
          ))}
        </div>
      )}

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
  const navigate = useNavigate();
  const { sessions, loading } = useAgentSessions(agent.agent_id, projectBindings);
  const taskCacheRef = useRef<Map<string, Task[]>>(new Map());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Record<string, Task[]>>({});
  const [loadingTasks, setLoadingTasks] = useState<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const session of sessions) {
      if (session.summary_of_previous_context) {
        setSummaries((prev) => ({ ...prev, [session.session_id]: session.summary_of_previous_context }));
      } else if (
        session.status !== "active" &&
        !summarizingRef.current.has(session.session_id)
      ) {
        summarizingRef.current.add(session.session_id);
        api
          .summarizeSession(session._projectId, session._agentInstanceId, session.session_id)
          .then((updated) => {
            if (updated.summary_of_previous_context) {
              setSummaries((prev) => ({ ...prev, [session.session_id]: updated.summary_of_previous_context }));
            }
          })
          .catch(() => {});
      }
    }
  }, [sessions]);

  const toggleExpand = useCallback(
    (sessionId: string) => {
      setExpandedSessions((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
          if (!taskCacheRef.current.has(sessionId) && !loadingTasks.has(sessionId)) {
            const session = sessions.find((s) => s.session_id === sessionId);
            if (session) {
              setLoadingTasks((p) => new Set(p).add(sessionId));
              api
                .listSessionTasks(session._projectId, session._agentInstanceId, session.session_id)
                .then((tasks) => {
                  taskCacheRef.current.set(sessionId, tasks);
                  setExpandedTasks((p) => ({ ...p, [sessionId]: tasks }));
                })
                .catch(() => {
                  taskCacheRef.current.set(sessionId, []);
                  setExpandedTasks((p) => ({ ...p, [sessionId]: [] }));
                })
                .finally(() => {
                  setLoadingTasks((p) => {
                    const n = new Set(p);
                    n.delete(sessionId);
                    return n;
                  });
                });
            }
          }
        }
        return next;
      });
    },
    [sessions, loadingTasks],
  );

  const handleSessionClick = useCallback(
    (session: AnnotatedSession) => {
      navigate(`/projects/${session._projectId}/agents/${session._agentInstanceId}?session=${session.session_id}`);
    },
    [navigate],
  );

  if (loading) {
    return <div className={styles.tabEmptyState}>Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <div className={styles.sessionListWrap}>
      {sessions.map((session, index) => {
        const totalTokens = session.total_input_tokens + session.total_output_tokens;
        const number = sessions.length - index;
        const expanded = expandedSessions.has(session.session_id);
        const tasks = expandedTasks[session.session_id];
        const isLoadingTasks = loadingTasks.has(session.session_id);
        const summary = summaries[session.session_id];

        return (
          <div key={session.session_id} className={styles.sessionCard}>
            <div className={styles.sessionCardHeader}>
              <button
                type="button"
                className={styles.sessionExpandBtn}
                onClick={() => toggleExpand(session.session_id)}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <StatusBadge status={session.status} />
              <button
                type="button"
                className={styles.sessionNumber}
                onClick={() => handleSessionClick(session)}
              >
                S{number}
              </button>
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
            </div>
            {summary && (
              <div
                className={styles.sessionSummary}
                onClick={() => handleSessionClick(session)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") handleSessionClick(session); }}
              >
                {summary}
              </div>
            )}
            {!summary && session.status !== "active" && summarizingRef.current.has(session.session_id) && (
              <div className={styles.sessionSummaryPlaceholder}>Generating summary...</div>
            )}
            {expanded && (
              <div className={styles.sessionTaskList}>
                {isLoadingTasks && <span className={styles.sessionTaskLoading}>Loading tasks...</span>}
                {tasks && tasks.length === 0 && !isLoadingTasks && (
                  <span className={styles.sessionTaskLoading}>No tasks</span>
                )}
                {tasks?.map((t) => (
                  <div key={t.task_id} className={styles.sessionTaskItem}>
                    <TaskStatusIcon status={t.status} />
                    <span className={styles.sessionTaskTitle}>{t.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
