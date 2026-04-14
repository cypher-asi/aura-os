import { Modal, Drawer, Button, Spinner } from "@cypher-asi/zui";
import type { Agent } from "../../types";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useAgentEditorForm } from "./useAgentEditorForm";
import { AgentEditorForm } from "./AgentEditorForm";
import { ImageCropModal } from "../ImageCropModal";
import styles from "./AgentEditorModal.module.css";

interface AgentEditorModalProps {
  isOpen: boolean;
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  titleOverride?: string;
  submitLabelOverride?: string;
  closeLabelOverride?: string;
  closeOnSave?: boolean;
  isTransitioning?: boolean;
}

export function AgentEditorModal({
  isOpen,
  agent,
  onClose,
  onSaved,
  titleOverride,
  submitLabelOverride,
  closeLabelOverride,
  closeOnSave = true,
  isTransitioning = false,
}: AgentEditorModalProps) {
  const { isMobileLayout } = useAuraCapabilities();
  const form = useAgentEditorForm(isOpen, agent, onClose, onSaved, closeOnSave);
  const isEditing = !!agent;
  const title = titleOverride ?? (isEditing ? "Edit Agent" : "Create Agent");
  const submitLabel = submitLabelOverride ?? (isEditing ? "Save Changes" : "Create Agent");
  const closeLabel = closeLabelOverride ?? "Cancel";
  const isPending = form.saving || isTransitioning;
  const formFields = (
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
      showAdvancedRuntime={form.showAdvancedRuntime}
      setShowAdvancedRuntime={form.setShowAdvancedRuntime}
      integrationId={form.integrationId}
      setIntegrationId={form.setIntegrationId}
      defaultModel={form.defaultModel}
      setDefaultModel={form.setDefaultModel}
      simplifyForMobileCreate={form.simplifyForMobileCreate}
      restrictCreateToAuraRuntimes={form.restrictCreateToAuraRuntimes}
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
  );
  const actionButtons = (
    <>
      <Button
        variant="ghost"
        onClick={form.handleClose}
        disabled={isPending}
      >
        {closeLabel}
      </Button>
      <Button
        variant="primary"
        onClick={form.handleSave}
        disabled={isPending}
      >
        {isPending ? (
          <>
            <Spinner size="sm" /> {submitLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </>
  );
  const content = (
    <div>
      {formFields}
      <div className={styles.footer}>
        {actionButtons}
      </div>
    </div>
  );

  return (
    <>
      {isMobileLayout ? (
        <Drawer
          side="bottom"
          isOpen={isOpen}
          onClose={form.handleClose}
          title={title}
          className={styles.mobileSheet}
          showMinimizedBar={false}
          defaultSize={640}
          maxSize={860}
        >
          <div className={styles.mobileSheetBody}>
            <div className={styles.mobileSheetScroll}>
              <div className={styles.mobileHeaderActions}>
                {actionButtons}
              </div>
              {formFields}
            </div>
          </div>
        </Drawer>
      ) : (
        <Modal
          isOpen={isOpen}
          onClose={form.handleClose}
          title={title}
          size="md"
          className={styles.compactModal}
          initialFocusRef={form.initialFocusRef}
          footer={null}
        >
          {content}
        </Modal>
      )}

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
