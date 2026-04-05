import { Modal, Button, Spinner } from "@cypher-asi/zui";
import type { Agent } from "../../types";
import { useAgentEditorForm } from "./useAgentEditorForm";
import { AgentEditorForm } from "./AgentEditorForm";
import { ImageCropModal } from "../ImageCropModal";
import styles from "./AgentEditorModal.module.css";

interface AgentEditorModalProps {
  isOpen: boolean;
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

export function AgentEditorModal({
  isOpen,
  agent,
  onClose,
  onSaved,
}: AgentEditorModalProps) {
  const form = useAgentEditorForm(isOpen, agent, onClose, onSaved);
  const isEditing = !!agent;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={form.handleClose}
        title={isEditing ? "Edit Agent" : "Create Agent"}
        size="md"
        initialFocusRef={form.initialFocusRef}
        footer={
          <div className={styles.footer}>
            <Button
              variant="ghost"
              onClick={form.handleClose}
              disabled={form.saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={form.handleSave}
              disabled={form.saving}
            >
              {form.saving ? (
                <>
                  <Spinner size="sm" /> Saving...
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Create Agent"
              )}
            </Button>
          </div>
        }
      >
        <AgentEditorForm
          name={form.name}
          setName={form.setName}
          role={form.role}
          setRole={form.setRole}
          isSuperAgent={form.isSuperAgent}
          personality={form.personality}
          setPersonality={form.setPersonality}
          systemPrompt={form.systemPrompt}
          setSystemPrompt={form.setSystemPrompt}
          icon={form.icon}
          adapterType={form.adapterType}
          setAdapterType={form.setAdapterType}
          environment={form.environment}
          setEnvironment={form.setEnvironment}
          authSource={form.authSource}
          setAuthSource={form.setAuthSource}
          integrationId={form.integrationId}
          setIntegrationId={form.setIntegrationId}
          defaultModel={form.defaultModel}
          setDefaultModel={form.setDefaultModel}
          availableIntegrations={form.availableIntegrations}
          nameError={form.nameError}
          setNameError={form.setNameError}
          nameRef={form.nameRef}
          fileInputRef={form.fileInputRef}
           error={form.error}
           handleFileSelect={form.handleFileSelect}
           handleAvatarClick={form.handleAvatarClick}
           handleAvatarRemove={form.handleAvatarRemove}
         />
      </Modal>

      <ImageCropModal
        isOpen={form.cropOpen}
        imageSrc={form.rawImageSrc}
        cropShape="round"
        outputSize={512}
        onConfirm={form.handleCropConfirm}
        onClose={form.handleCropClose}
        onChangeImage={form.handleChangeImage}
      />
    </>
  );
}
