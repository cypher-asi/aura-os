import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button, Input, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, Cloud, Sparkles } from "lucide-react";
import { api } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { filterRuntimeCompatibleIntegrations, getIntegrationLabel } from "../../lib/integrationCatalog";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useProjectActions } from "../../stores/project-action-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useOrgStore } from "../../stores/org-store";
import type { Agent, AgentInstance, OrgIntegration } from "../../types";
import { projectAgentAttachRoute, projectAgentChatRoute, projectAgentCreateRoute, projectRootPath } from "../../utils/mobileNavigation";
import styles from "./ProjectAgentSetupView.module.css";

const EMPTY_PROJECT_AGENTS: AgentInstance[] = [];
const EMPTY_INTEGRATIONS: OrgIntegration[] = [];

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
type ProjectAgentCreateStep = "default" | "options" | "integration";

export function ProjectAgentSetupView({ mode = "create" }: { mode?: ProjectAgentSetupViewMode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { isMobileLayout } = useAuraCapabilities();
  const { setAgentsByProject } = useProjectsList();
  const ctx = useProjectActions();
  const activeOrg = useOrgStore((state) => state.activeOrg);
  const orgIntegrations = useOrgStore((state) => state.integrations);
  const refreshIntegrations = useOrgStore((state) => state.refreshIntegrations);
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
  const [integrationId, setIntegrationId] = useState("");
  const [createStep, setCreateStep] = useState<ProjectAgentCreateStep>("default");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const assignedAgentIds = useMemo(
    () => new Set(assignedProjectAgents.map((agent) => agent.agent_id)),
    [assignedProjectAgents],
  );
  const compatibleIntegrations = useMemo(
    () => filterRuntimeCompatibleIntegrations("aura_harness", orgIntegrations ?? EMPTY_INTEGRATIONS),
    [orgIntegrations],
  );
  const hasExistingOption = availableAgents.length > 0;
  const hasIntegrationOption = compatibleIntegrations.length > 0;
  const selectedIntegration = useMemo(
    () => compatibleIntegrations.find((integration) => integration.integration_id === integrationId) ?? null,
    [compatibleIntegrations, integrationId],
  );
  const secondaryRouteLabel = useMemo(() => {
    if (hasExistingOption && hasIntegrationOption) {
      return "More agent options";
    }
    if (hasExistingOption) {
      return "Use existing remote agent";
    }
    if (hasIntegrationOption) {
      return "Use organization connection";
    }
    return null;
  }, [hasExistingOption, hasIntegrationOption]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }

    if (compatibleIntegrations.length === 0) {
      if (createStep === "integration") {
        setCreateStep("default");
      }
      if (integrationId) {
        setIntegrationId("");
      }
      return;
    }

    if (createStep === "integration" && !selectedIntegration) {
      setIntegrationId(compatibleIntegrations[0]?.integration_id ?? "");
    }
  }, [compatibleIntegrations, createStep, integrationId, mode, selectedIntegration]);

  useEffect(() => {
    if (mode !== "create" && createStep !== "default") {
      setCreateStep("default");
    }
  }, [createStep, mode]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    if (!activeOrg?.org_id || orgIntegrations.length > 0) {
      return;
    }
    void refreshIntegrations();
  }, [activeOrg?.org_id, mode, orgIntegrations.length, refreshIntegrations]);

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
    navigate(projectAgentChatRoute(instance.project_id, instance.agent_instance_id));
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
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    const selectedAuthSource = createStep === "integration" ? "org_integration" : "aura_managed";
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
        auth_source: selectedAuthSource,
        integration_id: selectedAuthSource === "org_integration" ? integrationId : null,
        default_model: null,
      });
      const instance = await api.createAgentInstance(projectId, created.agent_id);
      finishAttach(instance);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create a remote agent right now.");
    } finally {
      setCreating(false);
    }
  }, [activeOrg?.org_id, createStep, finishAttach, integrationId, name, projectId, role]);

  const handleOpenSecondaryRoute = useCallback(() => {
    if (!projectId) return;

    if (hasExistingOption && !hasIntegrationOption) {
      navigate(projectAgentAttachRoute(projectId));
      return;
    }

    if (!hasExistingOption && hasIntegrationOption) {
      setCreateStep("integration");
      if (!integrationId) {
        setIntegrationId(compatibleIntegrations[0]?.integration_id ?? "");
      }
      setFormError(null);
      return;
    }

    setCreateStep("options");
    setFormError(null);
  }, [compatibleIntegrations, hasExistingOption, hasIntegrationOption, integrationId, navigate, projectId]);

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
            : createStep === "options"
              ? "More Agent Options"
            : createStep === "integration"
              ? "Use Organization Connection"
              : "Create Remote Agent"}
        </Text>
        <Text size="sm" variant="muted">
          {mode === "existing"
            ? (currentProject
              ? `Attach another remote Aura agent to ${currentProject.name}.`
              : "Attach another remote Aura agent to this project.")
            : createStep === "options"
              ? "Choose another way to connect this project to a remote agent."
            : createStep === "integration"
              ? "Create this remote Aura agent with a shared provider connection from your organization."
              : (currentProject
                ? `Create a new remote Aura agent for ${currentProject.name}.`
                : "Create a new remote Aura agent for this project.")}
        </Text>
        {mode === "create" && createStep !== "default" ? (
          <button
            type="button"
            className={styles.inlineBackButton}
            onClick={() => {
              setCreateStep(createStep === "integration" ? "options" : "default");
              setFormError(null);
            }}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>{createStep === "integration" ? "Back to more options" : "Back to create"}</span>
          </button>
        ) : null}
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
              {createStep === "options" ? "Other ways to add an agent" : "New remote agent"}
            </Text>
            <Text size="xs" variant="muted">
              {createStep === "options"
                ? "Choose another remote-first path."
                : createStep === "integration"
                ? "Choose the shared connection that should power this agent."
                : "Create a remote Aura agent for this project."}
            </Text>
          </div>

          {loadingAgents ? (
            <div className={styles.loadingState}>
              <Spinner size="sm" />
            </div>
          ) : null}

          {createStep === "options" ? (
            <div className={styles.choiceList}>
              {availableAgents.length > 0 ? (
                <button
                  type="button"
                  className={styles.choiceCard}
                  onClick={() => navigate(projectAgentAttachRoute(projectId))}
                >
                  <span className={styles.choiceCopy}>
                    <span className={styles.choiceTitle}>Use existing remote agent</span>
                    <span className={styles.choiceMeta}>Attach another remote Aura agent that already exists in your library.</span>
                  </span>
                </button>
              ) : null}

              {compatibleIntegrations.length > 0 ? (
                <button
                  type="button"
                  className={styles.choiceCard}
                  onClick={() => {
                    setCreateStep("integration");
                    if (!integrationId) {
                      setIntegrationId(compatibleIntegrations[0]?.integration_id ?? "");
                    }
                    setFormError(null);
                  }}
                >
                  <span className={styles.choiceCopy}>
                    <span className={styles.choiceTitle}>Use organization connection</span>
                    <span className={styles.choiceMeta}>Power this remote agent with a shared provider connection from your organization.</span>
                  </span>
                </button>
              ) : null}

              {availableAgents.length === 0 && compatibleIntegrations.length === 0 ? (
                <div className={styles.inlineNotice}>
                  <Text size="sm" weight="medium">No extra options available yet</Text>
                  <Text size="xs" variant="muted">
                    Use the main remote-create path here, or set up shared connections on desktop first.
                  </Text>
                </div>
              ) : null}
            </div>
          ) : (
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
                <span>Aura remote agent</span>
                <span aria-hidden="true">·</span>
                <span><Cloud size={14} aria-hidden="true" /> Remote cloud</span>
                <span aria-hidden="true">·</span>
                <span>
                  {createStep === "integration" && selectedIntegration
                    ? getIntegrationLabel(selectedIntegration.provider)
                    : "Managed by Aura"}
                </span>
              </div>

              {createStep === "integration" ? (
            compatibleIntegrations.length > 0 ? (
              <div className={styles.choiceList} role="list" aria-label="Available organization integrations">
                {compatibleIntegrations.map((integration) => (
                  <button
                    key={integration.integration_id}
                    type="button"
                    className={styles.choiceCard}
                    data-selected={integration.integration_id === integrationId ? "true" : "false"}
                    onClick={() => {
                      setIntegrationId(integration.integration_id);
                      setFormError(null);
                    }}
                  >
                    <span className={styles.choiceCopy}>
                      <span className={styles.choiceTitle}>{integration.name}</span>
                      <span className={styles.choiceMeta}>{getIntegrationLabel(integration.provider)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.inlineNotice}>
                <Text size="sm" weight="medium">No organization integrations available</Text>
                <Text size="xs" variant="muted">
                  Add an Anthropic workspace connection in organization settings on desktop first, then come back here.
                </Text>
              </div>
            )
              ) : null}
            </>
          )}

          {mode === "create" && createStep === "default" && secondaryRouteLabel ? (
            <button
              type="button"
              className={styles.secondaryRouteButton}
              onClick={handleOpenSecondaryRoute}
            >
              {secondaryRouteLabel}
            </button>
          ) : null}

          <div className={styles.actionFooter}>
            <div className={styles.actionMessages}>
              {agentsError ? <Text size="sm" variant="muted">{agentsError}</Text> : null}
              {formError ? <Text size="sm" variant="muted">{formError}</Text> : null}
            </div>
            {createStep !== "options" ? (
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={creating || Boolean(attachingId) || (createStep === "integration" && !integrationId)}
                className={styles.createButton}
              >
                {creating ? "Creating agent…" : "Create & Add Agent"}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
