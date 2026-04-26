import { InlineRenameInput } from "../InlineRenameInput";
import { DeleteProjectModal } from "../DeleteProjectModal";
import { DeleteAgentInstanceModal } from "../DeleteAgentInstanceModal";
import { ProjectSettingsModal } from "../ProjectSettingsModal";
import { AgentSelectorModal } from "../../apps/agents/components/AgentSelectorModal";
import type { useProjectListActions } from "../../hooks/use-project-list-actions";

interface Props {
  actions: ReturnType<typeof useProjectListActions>;
}

export function ProjectListModals({ actions }: Props) {
  return (
    <>
      {actions.renameTarget && (
        <InlineRenameInput
          target={{ id: actions.renameTarget.project_id, name: actions.renameTarget.name }}
          onSave={actions.handleRename}
          onCancel={() => actions.setRenameTarget(null)}
        />
      )}

      {actions.renameAgentTarget && (
        <InlineRenameInput
          target={{
            id: actions.renameAgentTarget.agent_instance_id,
            name: actions.renameAgentTarget.name,
          }}
          onSave={actions.handleRenameAgent}
          onCancel={() => actions.setRenameAgentTarget(null)}
        />
      )}

      <ProjectSettingsModal
        target={actions.settingsTarget}
        onClose={() => actions.setSettingsTarget(null)}
        onSaved={actions.handleProjectSaved}
      />

      <DeleteProjectModal
        target={actions.deleteTarget}
        loading={actions.deleteLoading}
        error={actions.deleteError}
        onClose={() => {
          actions.setDeleteTarget(null);
          actions.setDeleteError(null);
        }}
        onDelete={actions.handleDelete}
      />

      <DeleteAgentInstanceModal
        target={actions.deleteAgentTarget}
        loading={actions.deleteAgentLoading}
        error={actions.deleteAgentError}
        onClose={() => {
          actions.setDeleteAgentTarget(null);
          actions.setDeleteAgentError(null);
        }}
        onDelete={actions.handleDeleteAgent}
      />

      <AgentSelectorModal
        isOpen={!!actions.agentSelectorProjectId}
        projectId={actions.agentSelectorProjectId!}
        onClose={() => actions.setAgentSelectorProjectId(null)}
        onCreated={actions.handleAgentCreated}
        isTransitioning={!!actions.pendingCreatedAgent}
      />
    </>
  );
}
