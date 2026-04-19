import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button, Input, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, Cloud, Sparkles } from "lucide-react";
import { ApiClientError, api } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getAgentNameValidationMessage } from "../../lib/agentNameValidation";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useOrgStore } from "../../stores/org-store";
import { queryClient } from "../../lib/query-client";
import { projectQueryKeys } from "../../queries/project-queries";
import type { Agent, AgentInstance } from "../../types";
import { emptyAgentPermissions } from "../../types/permissions-wire";
import { createAgentChatHandoffState } from "../../utils/chat-handoff";
import { projectAgentChatRoute, projectAgentCreateRoute, projectRootPath } from "../../utils/mobileNavigation";
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
  const { isMobileLayout } = useAuraCapabilities();
  const { setAgentsByProject } = useProjectsList();
  const activeOrg = useOrgStore((state) => state.activeOrg);
  const agentsByProject = useProjectsListStore((state) => state.agentsByProject);
  const assignedProjectAgents = useMemo(
    () => (projectId ? agentsByProject[projectId] ?? EMPTY_PROJECT_AGENTS : EMPTY_PROJECT_AGENTS),
    [agentsByProject, projectId],
  );

  const primaryProjectAgent = assignedProjectAgents[0] ?? null;

  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [hasResolvedExistingAgents, setHasResolvedExistingAgents] = useState(mode !== "existing");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [isRoleStep, setIsRoleStep] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const roleInputRef = useRef<HTMLInputElement>(null);
  const nameInputId = useId();
  const roleInputId = useId();
  const assignedAgentIds = useMemo(
    () => new Set(assignedProjectAgents.map((agent) => agent.agent_id)),
    [assignedProjectAgents],
  );
  const focusInput = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;

    const moveFocus = () => {
      input.focus();
      const caret = input.value.length;
      try {
        input.setSelectionRange(caret, caret);
      } catch {
        // Ignore input types that do not support selection ranges.
      }
    };

    moveFocus();

    if (document.activeElement !== input) {
      window.requestAnimationFrame(moveFocus);
      window.setTimeout(moveFocus, 0);
    }
  }, []);
  useEffect(() => {
    if (isRoleStep) {
      focusInput(roleInputRef.current);
      return;
    }

    focusInput(nameInputRef.current);
  }, [focusInput, isRoleStep]);
  const advanceToRoleStep = useCallback(() => {
    const validationMessage = getAgentNameValidationMessage(name);
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }

    setIsRoleStep(true);
  }, [name]);
  const flowTitle = isRoleStep ? "Give it a clear role" : "Name your remote agent";
  const flowDescription = isRoleStep
    ? "Add a short role so teammates know when to bring this agent in."
    : "Pick a short name you can recognize quickly when you are working on the go.";
  const updateName = useCallback((value: string) => {
    setName(value);
    setFormError(null);
  }, []);
  const updateRole = useCallback((value: string) => {
    setRole(value);
    setFormError(null);
  }, []);
  const handleNameInput = useCallback((event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) => {
    updateName(event.currentTarget.value);
  }, [updateName]);
  const handleRoleInput = useCallback((event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) => {
    updateRole(event.currentTarget.value);
  }, [updateRole]);

  useEffect(() => {
    if (!projectId) return;
    if (mode !== "existing") {
      setLoadingAgents(false);
      setHasResolvedExistingAgents(true);
      setAgentsError(null);
      setAvailableAgents([]);
      return;
    }

    let cancelled = false;
    setLoadingAgents(true);
    setHasResolvedExistingAgents(false);
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
      })
      .catch((error) => {
        if (cancelled) return;
        setAgentsError(error instanceof Error ? error.message : "Could not load available agents.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAgents(false);
          setHasResolvedExistingAgents(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrg?.org_id, assignedAgentIds, mode, projectId]);

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
        permissions: emptyAgentPermissions(),
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

  if (mode === "existing" && hasResolvedExistingAgents && !loadingAgents && availableAgents.length === 0) {
    return <Navigate to={projectAgentCreateRoute(projectId)} replace />;
  }

  return (
    <div className={styles.root}>
      {mode === "existing" ? (
        <header className={styles.header}>
          <Text size="lg" weight="medium">
            Add Existing Agent
          </Text>
          <Text size="sm" variant="muted">
            Attach a shared remote agent that is not already in this project.
          </Text>
        </header>
      ) : null}

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
            <div className={styles.flowEyebrow}>
              <span>{isRoleStep ? "Step 2 of 2" : "Step 1 of 2"}</span>
              <span aria-hidden="true">·</span>
              <span>{isRoleStep ? "Role" : "Name"}</span>
            </div>
            <Text size="lg" weight="medium">
              {flowTitle}
            </Text>
            <Text size="sm" variant="muted">
              {flowDescription}
            </Text>
          </div>

          {loadingAgents ? (
            <div className={styles.loadingState}>
              <Spinner size="sm" />
            </div>
          ) : null}

          <>
              <div className={styles.formGrid}>
                {!isRoleStep ? (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={nameInputId}>Name</label>
                    <Input
                      id={nameInputId}
                      ref={nameInputRef}
                      aria-label="Name"
                      name="agent-name"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoFocus
                      enterKeyHint="next"
                      inputMode="text"
                      spellCheck={false}
                      value={name}
                      onChange={handleNameInput}
                      onInput={handleNameInput}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") {
                          return;
                        }
                        event.preventDefault();
                        advanceToRoleStep();
                      }}
                      placeholder="e.g. Atlas…"
                    />
                  </div>
                ) : null}

                {isRoleStep ? (
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryHeader}>
                      <Sparkles size={15} aria-hidden="true" />
                      <Text size="xs" weight="medium" variant="muted">Agent name</Text>
                    </div>
                    <div className={styles.summaryValue}>{name}</div>
                    <button
                      type="button"
                      className={styles.summaryAction}
                      onClick={() => {
                        setIsRoleStep(false);
                      }}
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                  </div>
                ) : null}

                {isRoleStep ? (
                  <div
                    className={styles.field}
                    onClick={(event) => {
                      if (event.target instanceof HTMLInputElement) {
                        return;
                      }
                      focusInput(roleInputRef.current);
                    }}
                  >
                    <label
                      className={styles.label}
                      htmlFor={roleInputId}
                      onClick={() => focusInput(roleInputRef.current)}
                    >
                      Role
                    </label>
                    <Input
                      id={roleInputId}
                      ref={roleInputRef}
                      aria-label="Role"
                      name="agent-role"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      enterKeyHint="done"
                      inputMode="text"
                      spellCheck={false}
                      value={role}
                      onChange={handleRoleInput}
                      onInput={handleRoleInput}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") {
                          return;
                        }
                        event.preventDefault();
                        void handleCreate();
                      }}
                      placeholder="e.g. Senior Developer…"
                    />
                  </div>
                ) : null}
              </div>

              <div className={styles.setupSummaryCard}>
                <div className={styles.setupSummaryHeader}>
                  <Cloud size={15} aria-hidden="true" />
                  <span>Managed by Aura</span>
                </div>
                <div className={styles.setupSummaryCopy}>
                  Runs remotely with Aura-managed credentials, runtime, and billing.
                </div>
              </div>
          </>

          <div className={styles.actionFooter}>
            <div className={styles.actionMessages}>
              {agentsError ? <Text size="sm" variant="muted">{agentsError}</Text> : null}
              {formError ? <Text size="sm" variant="muted">{formError}</Text> : null}
            </div>
            <Button
              variant="primary"
              onClick={isRoleStep ? handleCreate : advanceToRoleStep}
              disabled={creating || Boolean(attachingId) || (!isRoleStep && name.trim().length === 0)}
              className={styles.createButton}
            >
              {creating ? "Creating Agent…" : isRoleStep ? "Create Agent" : "Next"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
