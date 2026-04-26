import { Modal, Drawer, Button, Spinner } from "@cypher-asi/zui";
import type { Agent } from "../../../../shared/types";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useAgentEditorForm } from "./useAgentEditorForm";
import { AgentEditorForm } from "./AgentEditorForm";
import { ImageCropModal } from "../../../../components/ImageCropModal";
import styles from "./AgentEditorModal.module.css";

interface AgentEditorModalProps {
  isOpen: boolean;
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void | Promise<void>;
  titleOverride?: string;
  submitLabelOverride?: string;
  closeLabelOverride?: string;
  closeOnSave?: boolean;
  isTransitioning?: boolean;
  forceRemoteOnlyCreate?: boolean;
  mobilePresentation?: "sheet" | "inline";
  showCloseAction?: boolean;
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
  forceRemoteOnlyCreate = false,
  mobilePresentation = "sheet",
  showCloseAction = true,
}: AgentEditorModalProps) {
  const { isMobileLayout } = useAuraCapabilities();
  const form = useAgentEditorForm(isOpen, agent, onClose, onSaved, closeOnSave, forceRemoteOnlyCreate);
  const isEditing = !!agent;
  const isInlineMobile = isMobileLayout && mobilePresentation === "inline";
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
      environment={form.environment}
      setEnvironment={form.setEnvironment}
      showAdvancedRuntime={form.showAdvancedRuntime}
      setShowAdvancedRuntime={form.setShowAdvancedRuntime}
      listingStatus={form.listingStatus}
      setListingStatus={form.setListingStatus}
      simplifyForMobileCreate={form.simplifyForMobileCreate}
      restrictCreateToAuraRuntimes={form.restrictCreateToAuraRuntimes}
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
    <div data-agent-surface="agent-editor-actions">
      {showCloseAction ? (
        <Button
          variant="ghost"
          onClick={form.handleClose}
          disabled={isPending}
        >
          {closeLabel}
        </Button>
      ) : null}
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
    </div>
  );
  const content = (
    <div data-agent-surface="agent-editor">
      {formFields}
      <div className={styles.footer}>
        {actionButtons}
      </div>
    </div>
  );

  return (
    <>
      {isInlineMobile ? (
        <div className={styles.inlineSurface}>
          <div className={styles.inlineScroll}>
            {formFields}
          </div>
          <div className={styles.inlineFooter}>
            {actionButtons}
          </div>
        </div>
      ) : isMobileLayout ? (
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
              {formFields}
            </div>
            <div className={styles.mobileSheetFooter}>
              {actionButtons}
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
