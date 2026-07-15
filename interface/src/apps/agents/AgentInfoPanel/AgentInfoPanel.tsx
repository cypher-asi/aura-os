import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Button } from "@cypher-asi/zui";
import { FolderOpen, X } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { AgentOrchestrationDashboard } from "../components/AgentOrchestrationDashboard";
import { AgentEditorModal } from "../components/AgentEditorModal";
import { PreviewOverlay } from "../../../components/PreviewOverlay";
import { SidekickList } from "../../../components/SidekickList";
import { api } from "../../../api/client";
import { getApiErrorMessage } from "../../../shared/utils/api-errors";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../stores/auth-store";
import { useOrgStore } from "../../../stores/org-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import {
  useCascadeDeleteAgent,
  type AgentProjectBinding,
} from "../hooks/use-cascade-delete-agent";
import { DeleteAgentConfirmModal } from "../hooks/DeleteAgentConfirmModal";
import { useDeferredModalOpen } from "../../../shared/hooks/use-deferred-modal-open";
import { SkillsTab } from "./SkillsTab";
import { MemoryTab } from "./MemoryTab";
import { LearningTab } from "./LearningTab";
import { SkillPreview } from "./SkillPreview";
import { FactPreview, EventPreview, ProcedurePreview } from "./MemoryPreview";
import { ProfileTab } from "./ProfileTab";
import { ChatsTab } from "./ChatsTab";
import { PermissionsTab } from "./PermissionsTab";
import { MessagingTab } from "./MessagingTab";
import type { Agent } from "../../../shared/types";
import { isSuperAgent } from "../../../shared/types/permissions";
import { isAgentOwnedByUser } from "../utils/agent-ownership";
import styles from "./AgentInfoPanel.module.css";

interface AgentInfoPanelProps {
  variant?: "default" | "mobileStandalone";
  /**
   * Override the agent resolved from `useSelectedAgent`. Used by apps that
   * reuse this panel (e.g. the Marketplace) to display an agent that isn't
   * in the local agent store. When provided, ownership still comes from
   * `agent.user_id`, so non-owned agents remain read-only.
   */
  agent?: Agent | null;
}

type BindingHint = "another-org" | "archived" | null;

function useBindingHints(bindings: AgentProjectBinding[]): Record<string, BindingHint> {
  const activeOrgId = useOrgStore((s) => s.activeOrg?.org_id ?? null);
  const projects = useProjectsListStore((s) => s.projects);
  const agentsByProject = useProjectsListStore((s) => s.agentsByProject);

  return useMemo(() => {
    const projectsById = new Map(projects.map((p) => [p.project_id, p]));
    const out: Record<string, BindingHint> = {};
    for (const binding of bindings) {
      const project = projectsById.get(binding.project_id);
      if (project && activeOrgId && project.org_id !== activeOrgId) {
        out[binding.project_agent_id] = "another-org";
        continue;
      }
      if (!project && activeOrgId) {
        // Binding refers to a project that isn't in the active-org list.
        // Almost always means it lives in a different org.
        out[binding.project_agent_id] = "another-org";
        continue;
      }
      const projectAgents = agentsByProject[binding.project_id];
      const instance = projectAgents?.find(
        (inst) => inst.agent_instance_id === binding.project_agent_id,
      );
      if (instance?.status === "archived") {
        out[binding.project_agent_id] = "archived";
        continue;
      }
      out[binding.project_agent_id] = null;
    }
    return out;
  }, [activeOrgId, agentsByProject, bindings, projects]);
}

function ProjectsTab({
  projectBindings,
  projectBindingsLoading,
  projectBindingsError,
  onRemoveBinding,
  onRetry,
  isOwnAgent,
}: {
  projectBindings: AgentProjectBinding[];
  projectBindingsLoading: boolean;
  projectBindingsError: string | null;
  onRemoveBinding: (binding: AgentProjectBinding) => Promise<void>;
  onRetry: () => void;
  isOwnAgent: boolean;
}) {
  const bindingHints = useBindingHints(projectBindings);

  if (projectBindingsLoading) {
    return <div className={styles.tabEmptyState}>Loading projects...</div>;
  }

  if (projectBindingsError && projectBindings.length === 0) {
    return (
      <div className={styles.section}>
        <Text size="xs" className={styles.deleteError}>{projectBindingsError}</Text>
        <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  if (projectBindings.length === 0) {
    return <div className={styles.tabEmptyState}>Not added to any projects</div>;
  }

  return (
    <div className={styles.section}>
      {projectBindingsError && (
        <Text size="xs" className={styles.deleteError}>{projectBindingsError}</Text>
      )}
      <SidekickList
        sections={[
          {
            id: "bindings",
            label: "Added to Projects",
            rows: projectBindings.map((b) => {
              const hint = bindingHints[b.project_agent_id];
              return {
                id: b.project_agent_id,
                icon: <FolderOpen size={13} />,
                label: (
                  <>
                    {b.project_name}
                    {hint === "another-org" && (
                      <span className={styles.bindingHint}> (in another org)</span>
                    )}
                    {hint === "archived" && (
                      <span className={styles.bindingHint}> (archived)</span>
                    )}
                  </>
                ),
                trailingAction: isOwnAgent ? (
                  <button
                    type="button"
                    className={styles.removeBinding}
                    title="Remove from project"
                    onClick={async () => {
                      try {
                        await onRemoveBinding(b);
                      } catch {
                        // Error state is handled by the parent so the panel can stay consistent.
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                ) : undefined,
              };
            }),
          },
        ]}
      />
    </div>
  );
}

export function AgentInfoPanel({ variant = "default", agent: agentOverride }: AgentInfoPanelProps) {
  const { selectedAgent: storeSelectedAgent, setSelectedAgent } = useSelectedAgent();
  const selectedAgent = agentOverride ?? storeSelectedAgent;
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    activeTab, showEditor, showDeleteConfirm,
    closeEditor, closeDeleteConfirm, requestEdit, requestDelete,
    previewItem, canGoBack, goBackPreview, closePreview, viewSkill,
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
      viewSkill: s.viewSkill,
    })),
  );

  const cascade = useCascadeDeleteAgent(selectedAgent);
  const [bindingRemovalError, setBindingRemovalError] = useState<string | null>(null);

  const handleRemoveBinding = useCallback(
    async (binding: AgentProjectBinding) => {
      if (!selectedAgent) return;
      setBindingRemovalError(null);
      try {
        await api.agents.removeProjectBinding(
          selectedAgent.agent_id,
          binding.project_agent_id,
        );
        await useProjectsListStore.getState().refreshProjectAgents(binding.project_id);
        await cascade.refresh();
      } catch (err) {
        setBindingRemovalError(getApiErrorMessage(err));
        throw err;
      }
    },
    [cascade, selectedAgent],
  );

  // Defer opening the confirm modal until cascade bindings have loaded
  // so the footer button label and cascade-warning paragraph are stable
  // from first paint. The mobile-standalone Delete button is disabled
  // during the brief preparing window.
  const { isOpen: deleteModalOpen, isPreparing: deletePreparing } =
    useDeferredModalOpen({
      requestedOpen: showDeleteConfirm,
      prepare: () => cascade.refresh(),
    });

  const openDeleteConfirm = useCallback(() => {
    cascade.reset();
    requestDelete();
  }, [cascade, requestDelete]);

  const handleCloseDeleteConfirm = useCallback(() => {
    closeDeleteConfirm();
    cascade.reset();
  }, [cascade, closeDeleteConfirm]);

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedAgent) return;
    try {
      await cascade.deleteWithCascade();
      handleCloseDeleteConfirm();
      setSelectedAgent(null);
      navigate("/agents");
    } catch {
      // Error state lives on `cascade.error` and is rendered in the modal.
    }
  }, [cascade, handleCloseDeleteConfirm, navigate, selectedAgent, setSelectedAgent]);

  if (!selectedAgent) {
    return <EmptyState>Select an agent to see details</EmptyState>;
  }

  const a = selectedAgent;
  const isOwnAgent = isAgentOwnedByUser(a, user);
  const isMobileStandalone = variant === "mobileStandalone";
  const effectiveTab = isMobileStandalone ? "profile" : activeTab;

  return (
    <div
      className={styles.wrapper}
      data-agent-surface="agent-detail-panel"
      data-agent-agent-id={a.agent_id}
      data-agent-agent-name={a.name}
      data-agent-active-tab={effectiveTab}
    >
      <div className={styles.scrollArea}>
        {effectiveTab === "profile" && (
          <ProfileTab
            agent={a}
            isOwnAgent={isOwnAgent}
            isMobileStandalone={isMobileStandalone}
            onViewSkill={viewSkill}
          />
        )}

        {effectiveTab === "chats" && <ChatsTab />}
        {effectiveTab === "skills" && <SkillsTab agent={a} />}
        {effectiveTab === "permissions" && (
          <PermissionsTab agent={a} isOwnAgent={isOwnAgent} />
        )}
        {effectiveTab === "messaging" && <MessagingTab agent={a} />}
        {effectiveTab === "learning" && (
          <LearningTab agent={a} isOwnAgent={isOwnAgent} />
        )}
        {effectiveTab === "projects" && (
          <ProjectsTab
            projectBindings={cascade.bindings}
            projectBindingsLoading={cascade.bindingsLoading}
            projectBindingsError={bindingRemovalError ?? cascade.bindingsError}
            onRemoveBinding={handleRemoveBinding}
            onRetry={() => {
              void cascade.refresh();
            }}
            isOwnAgent={isOwnAgent}
          />
        )}
        {effectiveTab === "tasks" && <div className={styles.tabEmptyState}>No tasks yet</div>}
        {effectiveTab === "processes" && <div className={styles.tabEmptyState}>No processes yet</div>}
        {effectiveTab === "logs" && <div className={styles.tabEmptyState}>No logs yet</div>}
        {effectiveTab === "memory" && (
          <MemoryTab agent={a} projectBindings={cascade.bindings} />
        )}
        {effectiveTab === "stats" && <div className={styles.tabEmptyState}>No stats yet</div>}

        {effectiveTab === "profile" && isSuperAgent(a) && (
          <AgentOrchestrationDashboard agent={a} />
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
          {previewItem.kind === "memory_fact" && (
            <FactPreview fact={previewItem.fact} agentId={a.agent_id} access={previewItem.access} />
          )}
          {previewItem.kind === "memory_event" && <EventPreview event={previewItem.event} />}
          {previewItem.kind === "memory_procedure" && <ProcedurePreview procedure={previewItem.procedure} />}
        </PreviewOverlay>
      )}

      {isMobileStandalone && isOwnAgent && (
        <div className={styles.mobileActions}>
          <Button variant="ghost" size="sm" onClick={requestEdit}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={openDeleteConfirm} disabled={deletePreparing}>Delete</Button>
        </div>
      )}

      <AgentEditorModal
        isOpen={showEditor}
        agent={selectedAgent ?? undefined}
        onClose={closeEditor}
        onSaved={(updated) => {
          const projectsStore = useProjectsListStore.getState();
          useAgentStore.getState().patchAgent(updated);
          projectsStore.patchAgentTemplateFields(updated);
          // Server folds `Agent.local_workspace_path` into every project
          // instance's `workspace_path` (see `resolve_workspace_path`).
          // Refresh the agent caches for each project hosting an instance
          // so the env-overlay's "Workspace Folder" row reflects the
          // new path without a manual reload.
          projectsStore.refreshAgentInstancesForTemplate(updated.agent_id);
          setSelectedAgent(updated.agent_id);
          useAgentStore.getState().fetchAgents({ force: true });
        }}
      />

      <DeleteAgentConfirmModal
        isOpen={deleteModalOpen}
        onClose={handleCloseDeleteConfirm}
        onDelete={handleConfirmDelete}
        deleting={cascade.deleting}
        deleteError={cascade.error}
        bindings={cascade.bindings}
        agentName={a.name}
      />
    </div>
  );
}
