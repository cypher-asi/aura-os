import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Spinner, Text } from "@cypher-asi/zui";
import { Link2, Sparkles } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ApiClientError, api } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { AgentEditorModal } from "../../apps/agents/components/AgentEditorModal";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useOrgStore } from "../../stores/org-store";
import { queryClient } from "../../shared/lib/query-client";
import { projectQueryKeys } from "../../queries/project-queries";
import type { Agent, AgentInstance } from "../../shared/types";
import { createAgentChatHandoffState } from "../../utils/chat-handoff";
import { projectAgentAttachRoute, projectAgentChatRoute, projectAgentCreateRoute, projectAgentsRoute, projectRootPath } from "../../utils/mobileNavigation";
import { setLastAgent, setLastProject } from "../../utils/storage";
import styles from "./ProjectAgentSetupView.module.css";

const EMPTY_PROJECT_AGENTS: AgentInstance[] = [];
const REMOTE_AGENT_READY_STATES = new Set(["running", "idle"]);
const REMOTE_AGENT_READY_POLL_MS = 2000;
const REMOTE_AGENT_READY_TIMEOUT_MS = 30000;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForRemoteAgentReady(agentId: string) {
  const deadline = Date.now() + REMOTE_AGENT_READY_TIMEOUT_MS;
  let lastTransientError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const state = await api.swarm.getRemoteAgentState(agentId);
      if (REMOTE_AGENT_READY_STATES.has(state.state)) {
        return;
      }
      if (state.state === "error") {
        throw new Error(state.error_message || "Remote agent entered an error state during startup.");
      }
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 400 || error.status === 401)) {
        throw error;
      }
      lastTransientError = error instanceof Error
        ? error
        : new Error("Could not verify remote agent startup.");
    }

    await delay(REMOTE_AGENT_READY_POLL_MS);
  }

  throw lastTransientError ?? new Error(
    "Remote agent is still provisioning. Please wait a moment and try again.",
  );
}

function upsertProjectAgent(
  instance: AgentInstance,
  setAgentsByProject: ReturnType<typeof useProjectsList>["setAgentsByProject"],
) {
  setAgentsByProject((prev) => {
    const existing = prev[instance.project_id] ?? [];
    if (existing.some((agent) => agent.agent_instance_id === instance.agent_instance_id)) {
      return prev;
    }
    return {
      ...prev,
      [instance.project_id]: [...existing, instance],
    };
  });
}

type ProjectAgentSetupViewMode = "create" | "existing";

export function ProjectAgentSetupView({ mode = "create" }: { mode?: ProjectAgentSetupViewMode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { isMobileClient } = useAuraCapabilities();
  const { setAgentsByProject } = useProjectsList();
  const { activeOrg, orgsError, orgsLoading } = useOrgStore(
    useShallow((state) => ({
      activeOrg: state.activeOrg,
      orgsError: state.orgsError,
      orgsLoading: state.isLoading,
    })),
  );
  const agentsByProject = useProjectsListStore((state) => state.agentsByProject);
  const assignedProjectAgents = useMemo(
    () => (projectId ? agentsByProject[projectId] ?? EMPTY_PROJECT_AGENTS : EMPTY_PROJECT_AGENTS),
    [agentsByProject, projectId],
  );

  const primaryProjectAgent = assignedProjectAgents[0] ?? null;

  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [hasLoadedExistingAgents, setHasLoadedExistingAgents] = useState(mode !== "existing");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const assignedAgentIds = useMemo(
    () => new Set(assignedProjectAgents.map((agent) => agent.agent_id)),
    [assignedProjectAgents],
  );

  useEffect(() => {
    if (!projectId) return;
    if (mode !== "existing") {
      setLoadingAgents(false);
      setHasLoadedExistingAgents(true);
      setAgentsError(null);
      setAvailableAgents([]);
      return;
    }

    if (orgsLoading) {
      setLoadingAgents(true);
      setHasLoadedExistingAgents(false);
      setAgentsError(null);
      setAvailableAgents([]);
      return;
    }

    if (!activeOrg?.org_id) {
      setLoadingAgents(false);
      setHasLoadedExistingAgents(false);
      setAgentsError(orgsError || "Could not resolve the active team for this project.");
      setAvailableAgents([]);
      return;
    }

    let cancelled = false;
    setLoadingAgents(true);
    setHasLoadedExistingAgents(false);
    setAgentsError(null);

    void api.agents.list(activeOrg?.org_id)
      .then((agents) => {
        if (cancelled) return;
        // The server already filters to the active org when
        // `activeOrg?.org_id` is passed; we still re-check here as
        // defense-in-depth for the brief window where `activeOrg` is
        // null (first mount) and the list comes back unscoped.
        const visibleRemoteAgents = agents.filter((agent) => (
          agent.org_id === activeOrg?.org_id &&
          agent.machine_type === "remote" &&
          !assignedAgentIds.has(agent.agent_id)
        ));
        setAvailableAgents(visibleRemoteAgents);
        setHasLoadedExistingAgents(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setAgentsError(error instanceof Error ? error.message : "Could not load available agents.");
        setHasLoadedExistingAgents(false);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAgents(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrg?.org_id, assignedAgentIds, mode, orgsError, orgsLoading, projectId]);

  const finishAttach = useCallback((instance: AgentInstance) => {
    upsertProjectAgent(instance, setAgentsByProject);
    setLastProject(instance.project_id);
    setLastAgent(instance.project_id, instance.agent_instance_id);
    queryClient.setQueryData(
      projectQueryKeys.agentInstance(instance.project_id, instance.agent_instance_id),
      instance,
    );
    navigate(projectAgentChatRoute(instance.project_id, instance.agent_instance_id), {
      state: createAgentChatHandoffState(),
    });
  }, [navigate, setAgentsByProject]);

  const handleAttachExisting = useCallback(async (agent: Agent) => {
    if (!projectId) return;
    setAttachingId(agent.agent_id);
    setFormError(null);
    try {
      const instance = await api.createAgentInstance(projectId, agent.agent_id);
      finishAttach(instance);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not add that agent to this project.");
    } finally {
      setAttachingId(null);
    }
  }, [finishAttach, projectId]);
  if (!projectId) {
    return null;
  }

  if (!isMobileClient) {
    return <Navigate to={projectRootPath(projectId)} replace />;
  }

  if (mode === "existing" && hasLoadedExistingAgents && !loadingAgents && !agentsError && availableAgents.length === 0) {
    return <Navigate to={projectAgentCreateRoute(projectId)} replace />;
  }

  if (mode === "create") {
    return (
      <ProjectAgentCreateSurface
        projectId={projectId}
        assignedProjectAgents={assignedProjectAgents}
        primaryProjectAgent={primaryProjectAgent}
        finishAttach={finishAttach}
      />
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size="lg" weight="medium">
          Add Existing Agent
        </Text>
        <Text size="sm" variant="muted">
          Attach a shared remote agent that is not already in this project.
        </Text>
      </header>

      {primaryProjectAgent ? (
        <section className={styles.contextSection}>
          <div className={styles.sectionHeader}>
            <Text size="xs" weight="medium" variant="muted">Current agent</Text>
            {assignedProjectAgents.length > 1 ? (
              <Text size="xs" variant="muted">{assignedProjectAgents.length - 1} more already attached</Text>
            ) : null}
          </div>
          <div className={styles.currentAgentList}>
            <div className={styles.currentAgentCard}>
              <Avatar avatarUrl={primaryProjectAgent.icon ?? undefined} name={primaryProjectAgent.name} type="agent" size={40} />
              <div className={styles.currentAgentCopy}>
                <span className={styles.agentName}>{primaryProjectAgent.name}</span>
                <span className={styles.agentMeta}>{primaryProjectAgent.role || "Remote Aura agent"}</span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text size="sm" weight="medium">Available Remote Agents</Text>
          <Text size="xs" variant="muted">Only agents that are not already attached appear here.</Text>
        </div>
        <div className={styles.agentList}>
          {availableAgents.map((agent) => (
            <button
              key={agent.agent_id}
              type="button"
              className={styles.agentCard}
              onClick={() => handleAttachExisting(agent)}
              disabled={Boolean(attachingId)}
            >
              <Avatar avatarUrl={agent.icon ?? undefined} name={agent.name} type="agent" size={44} />
              <span className={styles.agentCardCopy}>
                <span className={styles.agentName}>{agent.name}</span>
                <span className={styles.agentMeta}>{agent.role || "Remote Aura agent"}</span>
              </span>
              <span className={styles.agentCardAction}>
                {attachingId === agent.agent_id ? "Adding…" : "Add"}
              </span>
            </button>
          ))}
        </div>
        {loadingAgents ? (
          <div className={styles.loadingState}>
            <Spinner size="sm" />
          </div>
        ) : null}
        {agentsError ? <Text size="sm" variant="muted">{agentsError}</Text> : null}
        {formError ? <Text size="sm" variant="muted">{formError}</Text> : null}
      </section>
    </div>
  );
}

function ProjectAgentCreateSurface({
  projectId,
  assignedProjectAgents,
  primaryProjectAgent,
  finishAttach,
}: {
  projectId: string;
  assignedProjectAgents: AgentInstance[];
  primaryProjectAgent: AgentInstance | null;
  finishAttach: (instance: AgentInstance) => void;
}) {
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(true);
  const [pendingCreatedAgent, setPendingCreatedAgent] = useState<Agent | null>(null);

  const handleClose = useCallback(() => {
    setEditorOpen(false);
    navigate(projectAgentsRoute(projectId), { replace: true });
  }, [navigate, projectId]);

  const handleSaved = useCallback(async (agent: Agent) => {
    setPendingCreatedAgent(agent);
    await waitForRemoteAgentReady(agent.agent_id);
    const instance = await api.createAgentInstance(projectId, agent.agent_id);
    setPendingCreatedAgent(null);
    finishAttach(instance);
  }, [finishAttach, projectId]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size="xs" weight="medium" variant="muted" className={styles.flowEyebrow}>
          <Sparkles size={14} aria-hidden="true" />
          Create remote agent
        </Text>
        <Text size="lg" weight="medium">
          Create Remote Agent
        </Text>
        <Text size="sm" variant="muted">
          Create an Aura-managed agent for this project. The new agent will attach here as soon as setup finishes.
        </Text>
      </header>

      <section className={styles.setupSummaryCard}>
        <div className={styles.setupSummaryHeader}>
          <Link2 size={16} aria-hidden="true" />
          <span>Project setup</span>
        </div>
        <Text size="sm" variant="muted" className={styles.setupSummaryCopy}>
          Create a fresh agent for this project, or attach one your team already shares.
        </Text>
        {primaryProjectAgent ? (
          <div className={styles.summaryRow}>
            <span>Current agent</span>
            <span>{primaryProjectAgent.name}</span>
          </div>
        ) : null}
        <div className={styles.summaryRow}>
          <span>Already attached</span>
          <span>{assignedProjectAgents.length}</span>
        </div>
        {pendingCreatedAgent ? (
          <div className={styles.summaryRow}>
            <span>Pending attach</span>
            <span>{pendingCreatedAgent.name}</span>
          </div>
        ) : null}
        <button
          type="button"
          className={styles.summaryAction}
          onClick={() => navigate(projectAgentAttachRoute(projectId))}
        >
          Attach Existing Agent
        </button>
      </section>

      <AgentEditorModal
        isOpen={editorOpen}
        agent={pendingCreatedAgent ?? undefined}
        onClose={handleClose}
        onSaved={handleSaved}
        closeOnSave={false}
        forceRemoteOnlyCreate
        mobilePresentation="inline"
        submitLabelOverride={pendingCreatedAgent ? "Finish Attach" : "Create Agent"}
        showCloseAction={false}
      />
    </div>
  );
}
