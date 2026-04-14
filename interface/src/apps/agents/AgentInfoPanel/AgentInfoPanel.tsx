import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Button, Modal } from "@cypher-asi/zui";
import { Loader2, FolderOpen, X } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { SuperAgentDashboardPanel } from "../../../components/SuperAgentDashboardPanel";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
import { PreviewOverlay } from "../../../components/PreviewOverlay";
import { api } from "../../../api/client";
import { getApiErrorDetails, getApiErrorMessage } from "../../../utils/api-errors";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../stores/auth-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { SkillsTab } from "./SkillsTab";
import { MemoryTab } from "./MemoryTab";
import { SkillPreview } from "./SkillPreview";
import { FactPreview, EventPreview, ProcedurePreview } from "./MemoryPreview";
import { ProfileTab } from "./ProfileTab";
import { ChatsTab } from "./ChatsTab";
import type { Agent } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

interface AgentInfoPanelProps {
  variant?: "default" | "mobileStandalone";
}

type ProjectBinding = {
  project_agent_id: string;
  project_id: string;
  project_name: string;
};

function getDeleteAgentErrorMessage(err: unknown): string {
  const details = getApiErrorDetails(err);
  const message = getApiErrorMessage(err);
  return details ? `${message} ${details}` : message;
}

function useDeleteAgent(
  selectedAgent: Agent | null,
  setSelectedAgent: (id: string | null) => void,
  navigate: ReturnType<typeof useNavigate>,
  requestDelete: () => void,
  closeDeleteConfirm: () => void,
  refreshProjectBindings: () => Promise<void>,
) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      setDeleteError(getDeleteAgentErrorMessage(err));
      await refreshProjectBindings();
    } finally {
      setDeleting(false);
    }
  }, [
    selectedAgent,
    setSelectedAgent,
    navigate,
    handleCloseDeleteConfirm,
    refreshProjectBindings,
  ]);

  return { deleting, deleteError, openDeleteConfirm, handleDelete, handleCloseDeleteConfirm };
}

function DeleteConfirmModal({
  isOpen,
  onClose,
  onDelete,
  deleting,
  deleteError,
  agentName,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
  agentName: string;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Agent"
      size="sm"
      footer={
        <div className={styles.deleteFooter}>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={onDelete} disabled={deleting}>
            {deleting ? <><Loader2 size={14} className={styles.spin} /> Deleting...</> : "Delete"}
          </Button>
        </div>
      }
    >
      <Text size="sm">
        Are you sure you want to delete <strong>{agentName}</strong>? This cannot be undone.
      </Text>
      {deleteError && (
        <Text size="xs" className={styles.deleteError}>{deleteError}</Text>
      )}
    </Modal>
  );
}

function ProjectsTab({
  projectBindings,
  projectBindingsLoading,
  projectBindingsError,
  onRemoveBinding,
  onRetry,
  isOwnAgent,
}: {
  projectBindings: ProjectBinding[];
  projectBindingsLoading: boolean;
  projectBindingsError: string | null;
  onRemoveBinding: (binding: ProjectBinding) => Promise<void>;
  onRetry: () => void;
  isOwnAgent: boolean;
}) {
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
      <Text size="xs" variant="muted" weight="medium">Added to Projects</Text>
      {projectBindingsError && (
        <Text size="xs" className={styles.deleteError}>{projectBindingsError}</Text>
      )}
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
                    await onRemoveBinding(b);
                  } catch {
                    // Error state is handled by the parent so the panel can stay consistent.
                  }
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

export function AgentInfoPanel({ variant = "default" }: AgentInfoPanelProps) {
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
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
  const [projectBindings, setProjectBindings] = useState<ProjectBinding[]>([]);
  const [projectBindingsLoading, setProjectBindingsLoading] = useState(false);
  const [projectBindingsError, setProjectBindingsError] = useState<string | null>(null);

  const refreshProjectBindings = useCallback(async () => {
    if (!selectedAgent) {
      setProjectBindings([]);
      setProjectBindingsError(null);
      setProjectBindingsLoading(false);
      return;
    }

    setProjectBindingsLoading(true);
    setProjectBindingsError(null);
    try {
      const bindings = await api.agents.listProjectBindings(selectedAgent.agent_id);
      setProjectBindings(bindings);
    } catch (err) {
      setProjectBindings([]);
      setProjectBindingsError(getApiErrorMessage(err));
    } finally {
      setProjectBindingsLoading(false);
    }
  }, [selectedAgent]);

  const handleRemoveBinding = useCallback(async (binding: ProjectBinding) => {
    if (!selectedAgent) return;
    setProjectBindingsError(null);
    try {
      await api.agents.removeProjectBinding(selectedAgent.agent_id, binding.project_agent_id);
      await useProjectsListStore.getState().refreshProjectAgents(binding.project_id);
      await refreshProjectBindings();
    } catch (err) {
      setProjectBindingsError(getApiErrorMessage(err));
      throw err;
    }
  }, [selectedAgent, refreshProjectBindings]);

  const del = useDeleteAgent(
    selectedAgent,
    setSelectedAgent,
    navigate,
    requestDelete,
    closeDeleteConfirm,
    refreshProjectBindings,
  );

  useEffect(() => {
    void refreshProjectBindings();
  }, [refreshProjectBindings]);

  if (!selectedAgent) {
    return <EmptyState>Select an agent to see details</EmptyState>;
  }

  const a = selectedAgent;
  const isOwnAgent = !!user?.network_user_id && user.network_user_id === a.user_id;
  const isMobileStandalone = variant === "mobileStandalone";
  const effectiveTab = isMobileStandalone ? "profile" : activeTab;

  return (
    <div className={styles.wrapper}>
      <div className={styles.scrollArea}>
        {effectiveTab === "profile" && (
          <ProfileTab
            agent={a}
            isOwnAgent={isOwnAgent}
            isMobileStandalone={isMobileStandalone}
            onViewSkill={viewSkill}
          />
        )}

        {effectiveTab === "chats" && <ChatsTab agent={a} projectBindings={projectBindings} />}
        {effectiveTab === "skills" && <SkillsTab agent={a} />}
        {effectiveTab === "projects" && (
          <ProjectsTab
            projectBindings={projectBindings}
            projectBindingsLoading={projectBindingsLoading}
            projectBindingsError={projectBindingsError}
            onRemoveBinding={handleRemoveBinding}
            onRetry={() => {
              void refreshProjectBindings();
            }}
            isOwnAgent={isOwnAgent}
          />
        )}
        {effectiveTab === "tasks" && <div className={styles.tabEmptyState}>No tasks yet</div>}
        {effectiveTab === "processes" && <div className={styles.tabEmptyState}>No processes yet</div>}
        {effectiveTab === "logs" && <div className={styles.tabEmptyState}>No logs yet</div>}
        {effectiveTab === "memory" && <MemoryTab agent={a} />}
        {effectiveTab === "stats" && <div className={styles.tabEmptyState}>No stats yet</div>}

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
          <Button variant="ghost" size="sm" onClick={requestEdit}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={del.openDeleteConfirm}>Delete</Button>
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

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onClose={del.handleCloseDeleteConfirm}
        onDelete={del.handleDelete}
        deleting={del.deleting}
        deleteError={del.deleteError}
        agentName={a.name}
      />
    </div>
  );
}
