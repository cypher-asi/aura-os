import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Button, Modal } from "@cypher-asi/zui";
import { Loader2, FolderOpen, X } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { SuperAgentDashboardPanel } from "../../../components/SuperAgentDashboardPanel";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
import { PreviewOverlay } from "../../../components/PreviewOverlay";
import { api } from "../../../api/client";
import { getApiErrorMessage } from "../../../utils/api-errors";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../stores/auth-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useOrgStore } from "../../../stores/org-store";
import { SkillsTab } from "./SkillsTab";
import { MemoryTab } from "./MemoryTab";
import { SkillPreview } from "./SkillPreview";
import { FactPreview, EventPreview, ProcedurePreview } from "./MemoryPreview";
import { ProfileTab } from "./ProfileTab";
import { ChatsTab } from "./ChatsTab";
import {
  describeRuntimeReadiness,
  formatAdapterLabel,
  formatAuthSourceLabel,
  formatRunsOnLabel,
} from "./agent-info-utils";
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

function useRuntimeTest(selectedAgent: Agent | null) {
  const [runtimeTesting, setRuntimeTesting] = useState(false);
  const [runtimeTestMessage, setRuntimeTestMessage] = useState<string | null>(null);
  const [runtimeTestDetails, setRuntimeTestDetails] = useState<string | null>(null);
  const [runtimeTestStatus, setRuntimeTestStatus] = useState<"success" | "error" | null>(null);
  const runtimeResultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runtimeTestMessage || !runtimeResultRef.current) return;
    requestAnimationFrame(() => {
      runtimeResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [runtimeTestMessage]);

  const handleRuntimeTest = useCallback(async () => {
    if (!selectedAgent) return;
    setRuntimeTesting(true);
    setRuntimeTestMessage(null);
    setRuntimeTestDetails(null);
    setRuntimeTestStatus(null);
    try {
      const result = await api.agents.testRuntime(selectedAgent.agent_id);
      setRuntimeTestMessage(result.message || "Runtime test passed.");
      const details = [
        `${formatAdapterLabel(result.adapter_type)} on ${formatRunsOnLabel(result.environment)}`,
        `Authentication: ${formatAuthSourceLabel(result.auth_source, result.adapter_type)}`,
        result.integration_name ? `Integration: ${result.integration_name}` : null,
        result.provider ? `Provider: ${result.provider}` : null,
        result.model ? `Model: ${result.model}` : null,
      ].filter(Boolean).join(" \u2022 ");
      setRuntimeTestDetails(details || null);
      setRuntimeTestStatus("success");
    } catch (err) {
      setRuntimeTestMessage(err instanceof Error ? err.message : "Runtime test failed.");
      setRuntimeTestDetails(null);
      setRuntimeTestStatus("error");
    } finally {
      setRuntimeTesting(false);
    }
  }, [selectedAgent]);

  return {
    runtimeTesting,
    runtimeTestMessage,
    runtimeTestDetails,
    runtimeTestStatus,
    runtimeResultRef,
    handleRuntimeTest,
  };
}

function useDeleteAgent(
  selectedAgent: Agent | null,
  setSelectedAgent: (id: string | null) => void,
  navigate: ReturnType<typeof useNavigate>,
  requestDelete: () => void,
  closeDeleteConfirm: () => void,
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
      setDeleteError(getApiErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }, [selectedAgent, setSelectedAgent, navigate, handleCloseDeleteConfirm]);

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
  agent: a,
  projectBindings,
  setProjectBindings,
  isOwnAgent,
}: {
  agent: Agent;
  projectBindings: ProjectBinding[];
  setProjectBindings: React.Dispatch<React.SetStateAction<ProjectBinding[]>>;
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

export function AgentInfoPanel({ variant = "default" }: AgentInfoPanelProps) {
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
  const { user } = useAuth();
  const { integrations } = useOrgStore(useShallow((s) => ({ integrations: s.integrations })));
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

  const del = useDeleteAgent(selectedAgent, setSelectedAgent, navigate, requestDelete, closeDeleteConfirm);
  const rt = useRuntimeTest(selectedAgent);

  useEffect(() => {
    if (selectedAgent) {
      api.agents.listProjectBindings(selectedAgent.agent_id)
        .then(setProjectBindings)
        .catch(() => setProjectBindings([]));
    }
  }, [selectedAgent?.agent_id]);

  if (!selectedAgent) {
    return <EmptyState>Select an agent to see details</EmptyState>;
  }

  const a = selectedAgent;
  const selectedIntegration = a.integration_id
    ? integrations.find((i) => i.integration_id === a.integration_id) ?? null
    : null;
  const runtimeReadiness = describeRuntimeReadiness(a, selectedIntegration);
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
            runtimeTesting={rt.runtimeTesting}
            runtimeTestMessage={rt.runtimeTestMessage}
            runtimeTestDetails={rt.runtimeTestDetails}
            runtimeTestStatus={rt.runtimeTestStatus}
            onRuntimeTest={rt.handleRuntimeTest}
            runtimeResultRef={rt.runtimeResultRef}
            runtimeReadiness={runtimeReadiness}
            onViewSkill={viewSkill}
          />
        )}

        {effectiveTab === "chats" && <ChatsTab agent={a} projectBindings={projectBindings} />}
        {effectiveTab === "skills" && <SkillsTab agent={a} />}
        {effectiveTab === "projects" && (
          <ProjectsTab
            agent={a}
            projectBindings={projectBindings}
            setProjectBindings={setProjectBindings}
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
