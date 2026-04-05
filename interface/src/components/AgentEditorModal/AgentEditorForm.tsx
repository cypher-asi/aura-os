import { Input, Textarea, Text } from "@cypher-asi/zui";
import { ImagePlus, X, Monitor, Cloud } from "lucide-react";
import type { OrgIntegration } from "../../types";
import {
  MODEL_RUNTIME_ADAPTERS,
  filterRuntimeCompatibleIntegrations,
  getAdapterLabel,
  getConnectionAuthLabel,
  getIntegrationLabel,
  getLocalAuthLabel,
} from "../../lib/integrationCatalog";
import styles from "./AgentEditorModal.module.css";

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
        title: "Needs a connection",
        message:
          "Choose a matching connection before saving. Keys stay in Connections and are resolved only at runtime.",
      };
    }
    if (!selectedIntegration.has_secret) {
      return {
        tone: "warning",
        title: "Connection missing a key",
        message:
          "This connection does not have a stored API key yet. Add one in Connections before using it for runtime auth.",
      };
    }
    return {
      tone: "success",
      title: "Connection ready",
      message: `This runtime will use ${selectedIntegration.name}. Keys stay in Connections and are resolved only at runtime.`,
    };
  }

  if (authSource === "local_cli_auth") {
    return {
      tone: "info",
      title: "Uses a local login",
      message: `${getLocalAuthLabel(adapterType)} uses the login available to aura-os-server on this machine.`,
    };
  }

  return {
    tone: "success",
    title: "Managed by Aura",
    message:
      "Aura provides the credentials and billing for this runtime path.",
  };
}

export interface AgentEditorFormProps {
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  isSuperAgent: boolean;
  personality: string;
  setPersonality: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  icon: string;
  adapterType: string;
  setAdapterType: (v: string) => void;
  environment: string;
  setEnvironment: (v: string) => void;
  authSource: string;
  setAuthSource: (v: string) => void;
  integrationId: string;
  setIntegrationId: (v: string) => void;
  defaultModel: string;
  setDefaultModel: (v: string) => void;
  availableIntegrations: OrgIntegration[];
  nameError: string;
  setNameError: (v: string) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  error: string;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleAvatarClick: () => void;
  handleAvatarRemove: () => void;
}

export function AgentEditorForm({
  name,
  setName,
  role,
  setRole,
  isSuperAgent,
  personality,
  setPersonality,
  systemPrompt,
  setSystemPrompt,
  icon,
  adapterType,
  setAdapterType,
  environment,
  setEnvironment,
  authSource,
  setAuthSource,
  integrationId,
  setIntegrationId,
  defaultModel,
  setDefaultModel,
  availableIntegrations,
  nameError,
  setNameError,
  nameRef,
  fileInputRef,
  error,
  handleFileSelect,
  handleAvatarClick,
  handleAvatarRemove,
}: AgentEditorFormProps) {
  const integrationChoices = filterRuntimeCompatibleIntegrations(
    adapterType,
    availableIntegrations,
  );
  const showsIntegrationPicker = authSource === "org_integration";
  const selectedIntegration = integrationChoices.find(
    (integration) => integration.integration_id === integrationId,
  );
  const authReadiness = describeAuthReadiness(
    adapterType,
    authSource,
    selectedIntegration,
  );
  const readinessClassName =
    authReadiness.tone === "success"
      ? styles.readinessSuccess
      : authReadiness.tone === "warning"
        ? styles.readinessWarning
        : styles.readinessInfo;

  return (
    <div className={styles.form}>
      <FormSection title="Basics" description="Who this agent is and how it should present itself.">
        <div className={styles.avatarRow}>
          <button
            type="button"
            className={styles.avatarUpload}
            onClick={handleAvatarClick}
          >
            {icon ? (
              <img
                src={icon}
                alt="Agent avatar"
                className={styles.avatarImg}
              />
            ) : (
              <ImagePlus size={24} className={styles.avatarPlaceholder} />
            )}
            {icon && (
              <span
                className={styles.avatarRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAvatarRemove();
                }}
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
            onChange={(e) => {
              setName(e.target.value);
              setNameError("");
            }}
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
            <Text variant="muted" size="sm">
              SuperAgent role cannot be changed
            </Text>
          )}
        </div>
      </FormSection>

      <FormSection title="Runtime" description="Choose the runtime and where it executes.">
        <RuntimeFields
          adapterType={adapterType}
          setAdapterType={setAdapterType}
          environment={environment}
          setEnvironment={setEnvironment}
        />

        <Text variant="muted" size="sm">
          Changing the runtime updates the supported execution target,
          credential sources, and matching connections for this agent.
        </Text>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Default Model</label>
          <Input
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="Optional override (otherwise uses the runtime or connection default)"
          />
        </div>
      </FormSection>

      <FormSection title="Credentials" description="Pick how this runtime authenticates.">
        <AuthFields
          adapterType={adapterType}
          authSource={authSource}
          setAuthSource={setAuthSource}
        />

        {showsIntegrationPicker && (
          <IntegrationPicker
            integrationChoices={integrationChoices}
            integrationId={integrationId}
            setIntegrationId={setIntegrationId}
          />
        )}

        {!showsIntegrationPicker &&
          adapterType !== "aura_harness" &&
          availableIntegrations.length === 0 && (
            <div className={styles.fieldGroup}>
              <Text variant="muted" size="sm">
                Connections are optional for local CLI runtimes. You can keep using local login.
              </Text>
            </div>
          )}

        <div className={`${styles.readinessCard} ${readinessClassName}`}>
          <Text size="xs" weight="medium" className={styles.readinessTitle}>
            Runtime readiness
          </Text>
          <Text size="sm">{authReadiness.title}</Text>
          <Text size="xs" variant="muted">
            {authReadiness.message}
          </Text>
        </div>
      </FormSection>

      <FormSection title="Instructions" description="Guide how the agent behaves once it starts working.">
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
      </FormSection>

      {error && (
        <Text variant="muted" size="sm" className={styles.error}>
          {error}
        </Text>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.sectionBlock}>
      <div className={styles.sectionHeader}>
        <Text size="xs" weight="medium" className={styles.sectionTitle}>
          {title}
        </Text>
        {description ? (
          <Text size="xs" variant="muted">
            {description}
          </Text>
        ) : null}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function RuntimeFields({
  adapterType,
  setAdapterType,
  environment,
  setEnvironment,
}: {
  adapterType: string;
  setAdapterType: (v: string) => void;
  environment: string;
  setEnvironment: (v: string) => void;
}) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Runtime</label>
        <div className={styles.machineTypeToggle}>
          {(MODEL_RUNTIME_ADAPTERS as readonly string[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.machineTypeOption} ${adapterType === t ? styles.machineTypeActive : ""}`}
              onClick={() => setAdapterType(t)}
            >
              {getAdapterLabel(t)}
            </button>
          ))}
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
          {adapterType === "aura_harness" ? (
            <button
              type="button"
              className={`${styles.machineTypeOption} ${environment === "swarm_microvm" ? styles.machineTypeActive : ""}`}
              onClick={() => setEnvironment("swarm_microvm")}
            >
              <Cloud size={14} />
              Isolated Cloud Runtime
            </button>
          ) : null}
        </div>
        {adapterType !== "aura_harness" && (
          <Text variant="muted" size="sm">
            CLI-based runtimes currently run on this machine.
          </Text>
        )}
        {adapterType === "aura_harness" &&
          environment === "swarm_microvm" && (
            <Text variant="muted" size="sm">
              Isolated Cloud Runtime is the stronger boundary for sensitive
              workloads. The local path is the fully validated path today.
            </Text>
          )}
      </div>
    </>
  );
}

function AuthFields({
  adapterType,
  authSource,
  setAuthSource,
}: {
  adapterType: string;
  authSource: string;
  setAuthSource: (v: string) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Credential Source</label>
      <div className={styles.machineTypeToggle}>
        {adapterType === "aura_harness" ? (
          <>
            <button
              type="button"
              className={`${styles.machineTypeOption} ${authSource === "aura_managed" ? styles.machineTypeActive : ""}`}
              onClick={() => setAuthSource("aura_managed")}
            >
              Managed by Aura
            </button>
            <button
              type="button"
              className={`${styles.machineTypeOption} ${authSource === "org_integration" ? styles.machineTypeActive : ""}`}
              onClick={() => setAuthSource("org_integration")}
            >
              {getConnectionAuthLabel(adapterType)}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.machineTypeOption} ${authSource === "local_cli_auth" ? styles.machineTypeActive : ""}`}
              onClick={() => setAuthSource("local_cli_auth")}
            >
              {getLocalAuthLabel(adapterType)}
            </button>
            <button
              type="button"
              className={`${styles.machineTypeOption} ${authSource === "org_integration" ? styles.machineTypeActive : ""}`}
              onClick={() => setAuthSource("org_integration")}
            >
              {getConnectionAuthLabel(adapterType)}
            </button>
          </>
        )}
      </div>
      {adapterType === "aura_harness" ? (
        <Text variant="muted" size="sm">
          Aura can run with Aura-managed credentials or use a shared Anthropic connection
          for API-key-backed execution.
        </Text>
      ) : authSource === "local_cli_auth" ? (
        <Text variant="muted" size="sm">
          This agent will use the CLI login or shell auth already available on
          this machine. No workspace connection is required.
        </Text>
      ) : (
        <Text variant="muted" size="sm">
          This agent will inject a shared workspace connection into the runtime
          for API-key-backed execution.
        </Text>
      )}
    </div>
  );
}

function IntegrationPicker({
  integrationChoices,
  integrationId,
  setIntegrationId,
}: {
  integrationChoices: OrgIntegration[];
  integrationId: string;
  setIntegrationId: (v: string) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Connection</label>
      <div className={styles.integrationList}>
        {integrationChoices.map((integration) => (
          <button
            key={integration.integration_id}
            type="button"
            className={`${styles.integrationOption} ${integrationId === integration.integration_id ? styles.machineTypeActive : ""}`}
            onClick={() =>
              setIntegrationId(
                integration.integration_id === integrationId
                  ? ""
                  : integration.integration_id,
              )
            }
          >
            <span>{integration.name}</span>
            <span className={styles.integrationMeta}>
              {getIntegrationLabel(integration.provider)}
              {integration.default_model
                ? ` \u2022 ${integration.default_model}`
                : ""}
              {integration.has_secret
                ? " \u2022 key saved"
                : " \u2022 no key saved"}
            </span>
          </button>
        ))}
      </div>
      {integrationChoices.length === 0 && (
        <Text variant="muted" size="sm">
          Add a matching connection in Team Settings if you want
          API-key-backed auth for this runtime.
        </Text>
      )}
      {integrationId && (
        <Text variant="muted" size="sm">
          {integrationChoices.find(
            (integration) => integration.integration_id === integrationId,
          )?.has_secret
            ? "This connection has a stored key and is ready for runtime auth."
            : "This connection does not have a stored key yet. Add one in Team Settings before using it for runtime auth."}
        </Text>
      )}
    </div>
  );
}
