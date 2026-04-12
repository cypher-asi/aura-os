import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, CircleUserRound, Sparkles, X } from "lucide-react";
import { Button, Drawer, Text } from "@cypher-asi/zui";
import { api } from "../../api/client";
import { useChatStreamAdapter } from "../../hooks/use-chat-stream-adapter";
import { useChatHistorySync } from "../../hooks/use-chat-history-sync";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../hooks/use-agent-chat-meta";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { setLastAgent, setLastProject } from "../../utils/storage";
import { ChatPanel } from "../ChatPanel";
import { projectChatHistoryKey, agentHistoryKey } from "../../stores/chat-history-store";
import { useSelectedAgent, LAST_AGENT_ID_KEY } from "../../apps/agents/stores";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { projectAgentChatRoute, projectAgentCreateRoute, projectAgentDetailsRoute } from "../../utils/mobileNavigation";
import { useProjectAgentState } from "../ChatView/useProjectAgentState";
import { Avatar } from "../Avatar";
import styles from "./AgentChatView.module.css";

const AGENT_PROJECT_KEY_PREFIX = "aura-agent-project:";

function loadPersistedProject(agentId: string): string | undefined {
  try {
    return localStorage.getItem(`${AGENT_PROJECT_KEY_PREFIX}${agentId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistAgentProject(agentId: string, projectId: string) {
  try {
    localStorage.setItem(`${AGENT_PROJECT_KEY_PREFIX}${agentId}`, projectId);
  } catch { /* ignore */ }
}

type ChatMode = "project" | "agent";

const noopSend = () => {};

export function AgentChatView() {
  const { projectId, agentInstanceId, agentId } = useParams<{
    projectId: string;
    agentInstanceId: string;
    agentId: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get("session");
  const { isMobileLayout } = useAuraCapabilities();
  const [agentSwitcherOpen, setAgentSwitcherOpen] = useState(false);

  const mode: ChatMode = projectId && agentInstanceId ? "project" : "agent";
  const entityId = mode === "project" ? agentInstanceId : agentId;
  const isSessionView = !!(sessionId && mode === "project");
  const {
    projectAgents,
    selectedProjectAgent,
  } = useProjectAgentState({ projectId, agentInstanceId });
  const showProjectAgentSwitcher = mode === "project" && isMobileLayout && projectAgents.length > 1;

  // ── Derive project list for the dropdown ─────────────────────────────
  const allProjects = useProjectsListStore((s) => s.projects);
  const agentsByProject = useProjectsListStore((s) => s.agentsByProject);

  const agentProjects = useMemo(() => {
    if (mode !== "agent" || !agentId) return [];
    return allProjects.filter((p) => {
      const instances = agentsByProject[p.project_id];
      return instances?.some((inst) => inst.agent_id === agentId);
    });
  }, [mode, agentId, allProjects, agentsByProject]);

  const currentProject = useMemo(() => {
    if (mode !== "project" || !projectId) return [];
    const found = allProjects.find((p) => p.project_id === projectId);
    return found ? [found] : [];
  }, [mode, projectId, allProjects]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (mode !== "agent" || !agentId) return undefined;
    return loadPersistedProject(agentId);
  });

  const effectiveProjectId = useMemo(() => {
    if (mode !== "agent") return undefined;
    if (selectedProjectId && agentProjects.some((p) => p.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return undefined;
  }, [mode, selectedProjectId, agentProjects]);

  const handleProjectChange = useCallback(
    (pid: string) => {
      setSelectedProjectId(pid);
      if (agentId) persistAgentProject(agentId, pid);
    },
    [agentId],
  );

  // ── Stream hook (calls both, only active one receives real IDs) ─────
  const { streamKey, sendMessage, stopStreaming, resetEvents } =
    useChatStreamAdapter(mode, { projectId, agentInstanceId, agentId });

  // ── Unified agent metadata (name, machineType, templateAgentId) ────
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(mode, {
    projectId,
    agentInstanceId,
    agentId,
  });

  // ── History key ─────────────────────────────────────────────────────
  const historyKey = useMemo(() => {
    if (isSessionView && projectId && agentInstanceId && sessionId) {
      return `session:${projectId}:${agentInstanceId}:${sessionId}`;
    }
    if (mode === "project" && projectId && agentInstanceId) {
      return projectChatHistoryKey(projectId, agentInstanceId);
    }
    if (mode === "agent" && agentId) {
      return agentHistoryKey(agentId);
    }
    return undefined;
  }, [mode, projectId, agentInstanceId, agentId, isSessionView, sessionId]);

  // ── History fetch function ──────────────────────────────────────────
  const fetchFn = useMemo(() => {
    if (isSessionView && projectId && agentInstanceId && sessionId) {
      return () => api.listSessionEvents(projectId, agentInstanceId, sessionId);
    }
    if (mode === "project" && projectId && agentInstanceId) {
      return () => api.getEvents(projectId, agentInstanceId);
    }
    if (mode === "agent" && agentId) {
      return () => api.agents.listEvents(agentId);
    }
    return undefined;
  }, [mode, projectId, agentInstanceId, agentId, isSessionView, sessionId]);

  // ── Agent-mode: selection persistence ───────────────────────────────
  const { setSelectedAgent } = useSelectedAgent();
  const onAgentSwitch = useCallback(() => {
    if (mode !== "agent" || !agentId) return;
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  }, [mode, agentId, setSelectedAgent]);

  // ── Project-mode: storage ──────────────────────────────────────────
  const onProjectSwitch = useCallback(() => {
    if (mode !== "project" || !projectId || !agentInstanceId) return;
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [mode, projectId, agentInstanceId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const exitSessionView = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("session");
      return next;
    });
  }, [setSearchParams]);

  // ── Shared history sync ─────────────────────────────────────────────
  const { historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: mode === "agent" || isSessionView,
    onSwitch: mode === "project" ? onProjectSwitch : onAgentSwitch,
    onClear,
  });

  const wrappedSend = useMemo(
    () => wrapSend(sendMessage),
    [wrapSend, sendMessage],
  );

  const deferredLoading = useDelayedLoading(isLoading);
  const detailsLabel = selectedProjectAgent?.machine_type === "remote" ? "Skills" : "Settings";

  const handleSwitchProjectAgent = useCallback((nextAgentInstanceId: string) => {
    if (!projectId) return;
    setAgentSwitcherOpen(false);
    if (nextAgentInstanceId === agentInstanceId) return;
    navigate(projectAgentChatRoute(projectId, nextAgentInstanceId));
  }, [agentInstanceId, navigate, projectId]);

  // ── Render ──────────────────────────────────────────────────────────
  if (!entityId) return null;

  const panelKey = isSessionView ? `${entityId}:${sessionId}` : entityId;

  return (
    <>
      {isSessionView && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "var(--color-bg-hover)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: 12,
          color: "var(--color-text-secondary)",
        }}>
          <span>Viewing historical session</span>
          <button
            type="button"
            onClick={exitSessionView}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Back to live <X size={12} />
          </button>
        </div>
      )}
      <ChatPanel
        key={panelKey}
        streamKey={streamKey}
        onSend={isSessionView ? noopSend : wrappedSend}
        onStop={stopStreaming}
        agentName={agentName}
        machineType={machineType}
        templateAgentId={templateAgentId}
        adapterType={adapterType}
        defaultModel={defaultModel}
        agentId={entityId}
        isLoading={deferredLoading}
        historyResolved={historyResolved}
        errorMessage={historyError ? historyError : null}
        emptyMessage={isSessionView ? "No events in this session" : mode === "agent" ? "Send a message" : undefined}
        scrollResetKey={panelKey}
        projects={mode === "agent" ? agentProjects : currentProject}
        selectedProjectId={mode === "agent" ? effectiveProjectId : projectId}
        onProjectChange={mode === "agent" ? handleProjectChange : undefined}
        onMobileHeaderSummaryClick={
          mode === "project" && projectId && agentInstanceId
            ? showProjectAgentSwitcher
              ? () => setAgentSwitcherOpen(true)
              : undefined
            : undefined
        }
        mobileHeaderSummaryHint={
          mode === "project"
            ? showProjectAgentSwitcher
              ? `Switch active agent · ${projectAgents.length} in project`
              : "Current project agent"
            : undefined
        }
        mobileHeaderSummaryLabel={
          mode === "project"
            ? showProjectAgentSwitcher
              ? `Switch active project agent from ${agentName ?? "this agent"}`
              : undefined
            : undefined
        }
        mobileHeaderSummaryKind={showProjectAgentSwitcher ? "switch" : "details"}
        mobileHeaderAction={
          mode === "project" && projectId && agentInstanceId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(projectAgentDetailsRoute(projectId, agentInstanceId))}
              className={styles.projectAgentDetailsButton}
            >
              {detailsLabel}
            </Button>
          ) : undefined
        }
      />
      {mode === "project" && projectId && isMobileLayout ? (
        <Drawer
          side="bottom"
          isOpen={agentSwitcherOpen}
          onClose={() => setAgentSwitcherOpen(false)}
          title="Switch Agent"
          className={styles.mobileAgentSwitcher}
          showMinimizedBar={false}
          defaultSize={500}
          maxSize={700}
        >
          <div className={styles.mobileAgentSwitcherBody}>
            <div className={styles.mobileAgentSwitcherHeader}>
              <Text size="sm" weight="medium">Choose who you want to talk to in this project</Text>
              <Text size="sm" variant="muted">Skills and runtime stay in the agent details screen.</Text>
            </div>
            <div className={styles.mobileAgentSwitcherList}>
              {projectAgents.map((projectAgent) => {
                const isCurrent = projectAgent.agent_instance_id === agentInstanceId;
                return (
                  <button
                    key={projectAgent.agent_instance_id}
                    type="button"
                    className={`${styles.mobileAgentSwitcherRow} ${isCurrent ? styles.mobileAgentSwitcherRowCurrent : ""}`}
                    aria-pressed={isCurrent}
                    aria-label={isCurrent ? `${projectAgent.name}, current agent` : `Switch to ${projectAgent.name}`}
                    onClick={() => handleSwitchProjectAgent(projectAgent.agent_instance_id)}
                  >
                    <span className={styles.mobileAgentSwitcherIdentity}>
                      <Avatar
                        avatarUrl={projectAgent.icon ?? undefined}
                        name={projectAgent.name}
                        type="agent"
                        size={40}
                      />
                      <span className={styles.mobileAgentSwitcherCopy}>
                        <span className={styles.mobileAgentSwitcherName}>{projectAgent.name}</span>
                        <span className={styles.mobileAgentSwitcherMeta}>
                          {projectAgent.role?.trim()
                            ? projectAgent.role
                            : projectAgent.machine_type === "remote"
                              ? "Remote project agent"
                              : "Local project agent"}
                        </span>
                      </span>
                    </span>
                    <span className={styles.mobileAgentSwitcherStatus}>
                      {isCurrent ? (
                        <>
                          <Check size={14} aria-hidden="true" />
                          <span>Current</span>
                        </>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className={styles.mobileAgentSwitcherFooter}>
              <Button
                variant="ghost"
                size="sm"
                icon={<CircleUserRound size={16} />}
                onClick={() => {
                  setAgentSwitcherOpen(false);
                  navigate(projectAgentDetailsRoute(projectId, agentInstanceId!));
                }}
              >
                Open current agent
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Sparkles size={16} />}
                onClick={() => {
                  setAgentSwitcherOpen(false);
                  navigate(projectAgentCreateRoute(projectId));
                }}
              >
                Add remote agent
              </Button>
            </div>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
