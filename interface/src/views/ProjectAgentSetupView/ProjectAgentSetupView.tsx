import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button, Input, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, Cloud, Sparkles } from "lucide-react";
import { ApiClientError, api } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getAgentNameValidationMessage } from "../../lib/agentNameValidation";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useProjectActions } from "../../stores/project-action-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useOrgStore } from "../../stores/org-store";
import type { Agent, AgentInstance } from "../../types";
import { createAgentChatHandoffState } from "../../utils/chat-handoff";
import { projectAgentChatRoute, projectAgentCreateRoute, projectRootPath } from "../../utils/mobileNavigation";
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
  const { isMobileLayout } = useAuraCapabilities();
  const { setAgentsByProject } = useProjectsList();
  const ctx = useProjectActions();
  const activeOrg = useOrgStore((state) => state.activeOrg);
  const projects = useProjectsListStore((state) => state.projects);
  const agentsByProject = useProjectsListStore((state) => state.agentsByProject);
  const assignedProjectAgents = useMemo(
    () => (projectId ? agentsByProject[projectId] ?? EMPTY_PROJECT_AGENTS : EMPTY_PROJECT_AGENTS),
    [agentsByProject, projectId],
  );

  const currentProject = ctx?.project
    ?? projects.find((project) => project.project_id === projectId)
    ?? null;
  const primaryProjectAgent = assignedProjectAgents[0] ?? null;

  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const assignedAgentIds = useMemo(
    () => new Set(assignedProjectAgents.map((agent) => agent.agent_id)),
    [assignedProjectAgents],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoadingAgents(true);
    setAgentsError(null);

    void api.agents.list()
      .then((agents) => {
        if (cancelled) return;
        const visibleRemoteAgents = agents.filter((agent) => (
          agent.machine_type === "remote" &&
          !assignedAgentIds.has(agent.agent_id)
        ));
        setAvailableAgents(visibleRemoteAgents);
      })
      .catch((error) => {
        if (cancelled) return;
        setAgentsError(error instanceof Error ? error.message : "Could not load available agents.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAgents(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assignedAgentIds, projectId]);

  const finishAttach = useCallback((instance: AgentInstance) => {
    upsertProjectAgent(instance, setAgentsByProject);
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

  const handleCreate = useCallback(async () => {
    if (!projectId) return;
    const validationMessage = getAgentNameValidationMessage(name);
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await api.agents.create({
        org_id: activeOrg?.org_id,
        name: name.trim(),
        role: role.trim(),
        personality: "",
        system_prompt: "",
        icon: "",
        machine_type: "remote",
        adapter_type: "aura_harness",
        environment: "swarm_microvm",
        auth_source: "aura_managed",
        integration_id: null,
        default_model: null,
      });
      await waitForRemoteAgentReady(created.agent_id);
      const instance = await api.createAgentInstance(projectId, created.agent_id);
      finishAttach(instance);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create a remote agent right now.");
    } finally {
        setCreating(false);
    }
  }, [activeOrg?.org_id, finishAttach, name, projectId, role]);

  if (!projectId) {
    return null;
  }

  if (!isMobileLayout) {
    return <Navigate to={projectRootPath(projectId)} replace />;
  }

  if (mode === "existing" && !loadingAgents && availableAgents.length === 0) {
    return <Navigate to={projectAgentCreateRoute(projectId)} replace />;
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.sectionLabel}>Project Agent</div>
        <Text size="lg" weight="medium">
          {mode === "existing"
            ? "Choose Existing Agent"
            : "Create Aura Swarm Agent"}
        </Text>
        <Text size="sm" variant="muted">
          {mode === "existing"
            ? (currentProject
              ? `Attach another remote Aura agent to ${currentProject.name}.`
              : "Attach another remote Aura agent to this project.")
            : (currentProject
              ? `Create a new Aura swarm agent for ${currentProject.name}.`
              : "Create a new Aura swarm agent for this project.")}
        </Text>
      </header>

      {primaryProjectAgent && mode === "existing" ? (
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

      {mode === "existing" ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <button
              type="button"
              className={styles.inlineBackButton}
              onClick={() => navigate(projectAgentCreateRoute(projectId))}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>Back to create</span>
            </button>
            <Text size="sm" weight="medium">Available remote agents</Text>
            <Text size="xs" variant="muted">Only remote agents that are not already attached appear here.</Text>
          </div>
          <div className={styles.agentList}>
            {availableAgents.map((agent) => (
              <button
                key={agent.agent_id}
                type="button"
                className={styles.agentCard}
                onClick={() => handleAttachExisting(agent)}
                disabled={creating || Boolean(attachingId)}
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
          {formError ? <Text size="sm" variant="muted">{formError}</Text> : null}
        </section>
      ) : null}

      {mode === "create" ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text size="sm" weight="medium">
              New Aura swarm agent
            </Text>
            <Text size="xs" variant="muted">
              Create a remote Aura agent that uses Aura-managed credentials and billing.
            </Text>
          </div>

          {loadingAgents ? (
            <div className={styles.loadingState}>
              <Spinner size="sm" />
            </div>
          ) : null}

          <>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className={styles.label}>Name</span>
                  <Input
                    aria-label="Name"
                    name="agent-name"
                    autoComplete="off"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setFormError(null);
                    }}
                    placeholder="e.g. Atlas…"
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>Role</span>
                  <Input
                    aria-label="Role"
                    name="agent-role"
                    autoComplete="off"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    placeholder="e.g. Senior Developer…"
                  />
                </label>
              </div>

              <div className={styles.inlineSetupSummary}>
                <Sparkles size={15} aria-hidden="true" />
                <span>Aura swarm agent</span>
                <span aria-hidden="true">·</span>
                <span><Cloud size={14} aria-hidden="true" /> Aura Swarm</span>
                <span aria-hidden="true">·</span>
                <span>Aura-managed billing</span>
              </div>
          </>

          <div className={styles.actionFooter}>
            <div className={styles.actionMessages}>
              {agentsError ? <Text size="sm" variant="muted">{agentsError}</Text> : null}
              {formError ? <Text size="sm" variant="muted">{formError}</Text> : null}
            </div>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating || Boolean(attachingId)}
              className={styles.createButton}
            >
              {creating ? "Creating agent…" : "Create & Add Agent"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
