import { Modal, Input, Textarea, Button, Spinner, Text } from "@cypher-asi/zui";
import { ImagePlus, X, Monitor, Cloud } from "lucide-react";
import type { Agent, OrgIntegration } from "../../types";
import { useAgentEditorForm } from "./useAgentEditorForm";
import { ImageCropModal } from "../ImageCropModal";
import styles from "./AgentEditorModal.module.css";

interface AgentEditorModalProps {
  isOpen: boolean;
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

type ReadinessTone = "info" | "success" | "warning";

function describeAuthReadiness(
  adapterType: string,
  authSource: string,
  selectedIntegration?: OrgIntegration,
): { tone: ReadinessTone; title: string; message: string } {
  if (authSource === "org_integration") {
    if (!selectedIntegration) {
      return {
        tone: "warning",
        title: "Needs a team integration",
        message: "Choose a matching team integration before saving. Keys stay at the org integration layer and are resolved only at runtime.",
      };
    }
    if (!selectedIntegration.has_secret) {
      return {
        tone: "warning",
        title: "Integration missing a key",
        message: "This team integration does not have a stored API key yet. Add one in Team Settings before using it for runtime auth.",
      };
    }
    return {
      tone: "success",
      title: "Team integration ready",
      message: `This runtime will use ${selectedIntegration.name}. Keys stay at the org integration layer and are resolved only at runtime.`,
    };
  }

  if (authSource === "local_cli_auth") {
    const runtimeName = adapterType === "claude_code" ? "Claude Code" : "Codex";
    return {
      tone: "info",
      title: "Uses a local login",
      message: `${runtimeName} uses the CLI login available to aura-os-server on this machine. Save the agent, then use Check Runtime to verify the CLI is installed and logged in.`,
    };
  }

  return {
    tone: "success",
    title: "Uses Aura billing",
    message: "Aura Billing is managed by Aura. Save the agent, then use Check Runtime to verify the live runtime path.",
  };
}

export function AgentEditorModal({ isOpen, agent, onClose, onSaved }: AgentEditorModalProps) {
  const {
    name, setName, role, setRole, isSuperAgent, personality, setPersonality,
    systemPrompt, setSystemPrompt, icon,
    adapterType, setAdapterType, environment, setEnvironment,
    authSource, setAuthSource,
    integrationId, setIntegrationId, defaultModel, setDefaultModel, availableIntegrations,
    saving, error, nameError, setNameError,
    nameRef, initialFocusRef, fileInputRef,
    cropOpen, rawImageSrc,
    handleSave, handleClose, handleFileSelect, handleCropConfirm, handleCropClose,
    handleAvatarClick, handleAvatarRemove, handleChangeImage,
  } = useAgentEditorForm(isOpen, agent, onClose, onSaved);

  const isEditing = !!agent;
  const integrationChoices = availableIntegrations.filter((integration) => {
    if (adapterType === "aura_harness") return integration.provider === "anthropic";
    if (adapterType === "claude_code") return integration.provider === "anthropic";
    if (adapterType === "codex") return integration.provider === "openai";
    return false;
  });
  const showsIntegrationPicker = authSource === "org_integration";
  const selectedIntegration = integrationChoices.find((integration) => integration.integration_id === integrationId);
  const authReadiness = describeAuthReadiness(adapterType, authSource, selectedIntegration);
  const readinessClassName =
    authReadiness.tone === "success" ? styles.readinessSuccess
    : authReadiness.tone === "warning" ? styles.readinessWarning
    : styles.readinessInfo;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={isEditing ? "Edit Agent" : "Create Agent"}
        size="md"
        initialFocusRef={initialFocusRef}
        footer={
          <div className={styles.footer}>
            <Button variant="ghost" onClick={handleClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? <><Spinner size="sm" /> Saving...</> : isEditing ? "Save Changes" : "Create Agent"}
            </Button>
          </div>
        }
      >
        <div className={styles.form}>
          <div className={styles.avatarRow}>
            <button
              type="button"
              className={styles.avatarUpload}
              onClick={handleAvatarClick}
            >
              {icon ? (
                <img src={icon} alt="Agent avatar" className={styles.avatarImg} />
              ) : (
                <ImagePlus size={24} className={styles.avatarPlaceholder} />
              )}
              {icon && (
                <span
                  className={styles.avatarRemove}
                  onClick={(e) => { e.stopPropagation(); handleAvatarRemove(); }}
                >
                  <X size={12} />
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={handleFileSelect}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Name *</label>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(""); }}
              placeholder="e.g. Atlas"
              validationMessage={nameError}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Role</label>
            <Input
              value={isSuperAgent ? "SuperAgent" : role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Senior Developer"
              disabled={isSuperAgent}
            />
            {isSuperAgent && (
              <Text variant="muted" size="sm">SuperAgent role cannot be changed</Text>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Runtime</label>
            <div className={styles.machineTypeToggle}>
              <button
                type="button"
                className={`${styles.machineTypeOption} ${adapterType === "aura_harness" ? styles.machineTypeActive : ""}`}
                onClick={() => setAdapterType("aura_harness")}
              >
                Aura
              </button>
              <button
                type="button"
                className={`${styles.machineTypeOption} ${adapterType === "claude_code" ? styles.machineTypeActive : ""}`}
                onClick={() => setAdapterType("claude_code")}
              >
                Claude Code
              </button>
              <button
                type="button"
                className={`${styles.machineTypeOption} ${adapterType === "codex" ? styles.machineTypeActive : ""}`}
                onClick={() => setAdapterType("codex")}
              >
                Codex
              </button>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Runs On</label>
            <div className={styles.machineTypeToggle}>
              <button
                type="button"
                className={`${styles.machineTypeOption} ${environment === "local_host" ? styles.machineTypeActive : ""}`}
                onClick={() => setEnvironment("local_host")}
              >
                <Monitor size={14} />
                This Machine
              </button>
              <button
                type="button"
                className={`${styles.machineTypeOption} ${environment === "swarm_microvm" ? styles.machineTypeActive : ""}`}
                onClick={() => setEnvironment("swarm_microvm")}
                disabled={adapterType !== "aura_harness"}
              >
                <Cloud size={14} />
                Isolated Cloud Runtime
              </button>
            </div>
            {adapterType !== "aura_harness" && (
              <Text variant="muted" size="sm">Claude Code and Codex currently run on this machine.</Text>
            )}
            {adapterType === "aura_harness" && environment === "swarm_microvm" && (
              <Text variant="muted" size="sm">
                Isolated Cloud Runtime is the stronger boundary for sensitive workloads. The local path is the fully validated path today.
              </Text>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Authentication</label>
            <div className={styles.machineTypeToggle}>
              {adapterType === "aura_harness" ? (
                <>
                  <button
                    type="button"
                    className={`${styles.machineTypeOption} ${authSource === "aura_managed" ? styles.machineTypeActive : ""}`}
                    onClick={() => setAuthSource("aura_managed")}
                  >
                    Aura Billing
                  </button>
                  <button
                    type="button"
                    className={`${styles.machineTypeOption} ${authSource === "org_integration" ? styles.machineTypeActive : ""}`}
                    onClick={() => setAuthSource("org_integration")}
                  >
                    Use Team Integration
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`${styles.machineTypeOption} ${authSource === "local_cli_auth" ? styles.machineTypeActive : ""}`}
                    onClick={() => setAuthSource("local_cli_auth")}
                  >
                    Use Local Login
                  </button>
                  <button
                    type="button"
                    className={`${styles.machineTypeOption} ${authSource === "org_integration" ? styles.machineTypeActive : ""}`}
                    onClick={() => setAuthSource("org_integration")}
                  >
                    Use Team Integration
                  </button>
                </>
              )}
            </div>
            {adapterType === "aura_harness" ? (
              <Text variant="muted" size="sm">
                Aura can run on Aura billing or use a shared Anthropic team integration for BYOK execution.
              </Text>
            ) : authSource === "local_cli_auth" ? (
              <Text variant="muted" size="sm">
                This agent will use the CLI login or shell auth already available on this machine. No team integration is required.
              </Text>
            ) : (
              <Text variant="muted" size="sm">
                This agent will inject a shared team integration into the runtime for API-key-backed execution.
              </Text>
            )}
          </div>

          <div className={`${styles.readinessCard} ${readinessClassName}`}>
            <Text size="xs" weight="medium" className={styles.readinessTitle}>
              Authentication readiness
            </Text>
            <Text size="sm">{authReadiness.title}</Text>
            <Text size="xs" variant="muted">{authReadiness.message}</Text>
          </div>

          {showsIntegrationPicker && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Team Integration</label>
              <div className={styles.integrationList}>
                {integrationChoices.map((integration) => (
                  <button
                    key={integration.integration_id}
                    type="button"
                    className={`${styles.integrationOption} ${integrationId === integration.integration_id ? styles.machineTypeActive : ""}`}
                    onClick={() => setIntegrationId(integration.integration_id === integrationId ? "" : integration.integration_id)}
                  >
                    <span>{integration.name}</span>
                    <span className={styles.integrationMeta}>
                      {integration.provider}
                      {integration.default_model ? ` • ${integration.default_model}` : ""}
                      {integration.has_secret ? " • key saved" : " • no key saved"}
                    </span>
                  </button>
                ))}
              </div>
              {integrationChoices.length === 0 && (
                <Text variant="muted" size="sm">
                  Add a matching team integration in Team Settings if you want API-key-backed auth for this runtime.
                </Text>
              )}
              {integrationId && (
                <Text variant="muted" size="sm">
                  {integrationChoices.find((integration) => integration.integration_id === integrationId)?.has_secret
                    ? "This integration has a stored key and is ready for runtime auth."
                    : "This integration does not have a stored key yet. Add one in Team Settings before using it for runtime auth."}
                </Text>
              )}
            </div>
          )}

          {!showsIntegrationPicker && adapterType !== "aura_harness" && availableIntegrations.length === 0 && (
            <div className={styles.fieldGroup}>
              <Text variant="muted" size="sm">
                Team integrations are optional for Claude Code and Codex. You can keep using local login.
              </Text>
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Default Model</label>
            <Input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="Optional override (otherwise uses the adapter or integration default)"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Personality</label>
            <Textarea
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="e.g. Thorough, opinionated, loves clean code"
              rows={2}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>System Prompt</label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Instructions for this agent (agents.md content)..."
              rows={6}
              mono
            />
          </div>

          {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
        </div>
      </Modal>

      <ImageCropModal
        isOpen={cropOpen}
        imageSrc={rawImageSrc}
        cropShape="round"
        outputSize={512}
        onConfirm={handleCropConfirm}
        onClose={handleCropClose}
        onChangeImage={handleChangeImage}
      />
    </>
  );
}
