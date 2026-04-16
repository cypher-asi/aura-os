import { useEffect } from "react";
import { Input, Textarea, Text } from "@cypher-asi/zui";
import { ImagePlus, X, Monitor, Cloud } from "lucide-react";
import type { OrgIntegration } from "../../types";
import {
  MODEL_RUNTIME_ADAPTERS,
  filterRuntimeCompatibleIntegrations,
  getAdapterLabel,
  getConnectionAuthLabel,
  getConnectionAuthHint,
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

function CompactEnvironmentPicker({
  environment,
  setEnvironment,
}: {
  environment: string;
  setEnvironment: (v: string) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Environment</label>
      <div className={styles.envGrid}>
        <button
          type="button"
          className={`${styles.envOption} ${environment === "swarm_microvm" ? styles.envOptionActive : ""}`}
          onClick={() => setEnvironment("swarm_microvm")}
        >
          <Cloud size={14} />
          Remote
        </button>
        <button
          type="button"
          className={`${styles.envOption} ${environment === "local_host" ? styles.envOptionActive : ""}`}
          onClick={() => setEnvironment("local_host")}
        >
          <Monitor size={14} />
          Local
        </button>
      </div>
    </div>
  );
}

export interface AgentEditorFormProps {
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  isSuperAgent: boolean;
  personality: string;
  setPersonality: (v: string) => void;
  icon: string;
  adapterType: string;
  setAdapterType: (v: string) => void;
  environment: string;
  setEnvironment: (v: string) => void;
  authSource: string;
  setAuthSource: (v: string) => void;
  showAdvancedRuntime: boolean;
  setShowAdvancedRuntime: (v: boolean) => void;
  integrationId: string;
  setIntegrationId: (v: string) => void;
  defaultModel: string;
  setDefaultModel: (v: string) => void;
  simplifyForMobileCreate: boolean;
  restrictCreateToAuraRuntimes: boolean;
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
  icon,
  adapterType,
  setAdapterType,
  environment,
  setEnvironment,
  authSource,
  setAuthSource,
  showAdvancedRuntime,
  setShowAdvancedRuntime,
  integrationId,
  setIntegrationId,
  defaultModel,
  setDefaultModel,
  simplifyForMobileCreate,
  restrictCreateToAuraRuntimes,
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
  const isDefaultAuraPath =
    adapterType === "aura_harness" &&
    authSource === "aura_managed" &&
    !integrationId &&
    !defaultModel.trim();

  useEffect(() => {
    if (!restrictCreateToAuraRuntimes || !simplifyForMobileCreate) {
      return;
    }
    if (authSource !== "aura_managed") {
      setAuthSource("aura_managed");
    }
  }, [authSource, restrictCreateToAuraRuntimes, setAuthSource, simplifyForMobileCreate]);

  return (
    <div className={styles.form}>
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
            <ImagePlus size={20} className={styles.avatarPlaceholder} />
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
          aria-label="Name"
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
          aria-label="Role"
          value={isSuperAgent ? "SuperAgent" : role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. Senior Developer"
          disabled={isSuperAgent}
        />
      </div>

      {restrictCreateToAuraRuntimes && simplifyForMobileCreate ? (
        <CompactEnvironmentPicker
          environment="swarm_microvm"
          setEnvironment={setEnvironment}
        />
      ) : restrictCreateToAuraRuntimes ? (
        <CompactEnvironmentPicker
          environment={environment}
          setEnvironment={setEnvironment}
        />
      ) : !showAdvancedRuntime ? (
        <>
          <CompactEnvironmentPicker
            environment={environment}
            setEnvironment={setEnvironment}
          />
          <button
            type="button"
            className={styles.inlineAction}
            onClick={() => setShowAdvancedRuntime(true)}
          >
            Advanced options
          </button>
        </>
      ) : (
        <>
          <div className={styles.runtimeSectionHeader}>
            <Text size="sm" weight="medium">
              Advanced
            </Text>
            {isDefaultAuraPath ? (
              <button
                type="button"
                className={styles.inlineAction}
                onClick={() => setShowAdvancedRuntime(false)}
              >
                Hide
              </button>
            ) : null}
          </div>

          <RuntimeFields
            adapterType={adapterType}
            setAdapterType={setAdapterType}
            environment={environment}
            setEnvironment={setEnvironment}
          />

          <AuthFields
            adapterType={adapterType}
            authSource={authSource}
            setAuthSource={setAuthSource}
          />

          {showsIntegrationPicker ? (
            <IntegrationPicker
              integrationChoices={integrationChoices}
              integrationId={integrationId}
              setIntegrationId={setIntegrationId}
            />
          ) : null}

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Default Model</label>
            <Input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="Optional override"
            />
          </div>

          <div className={`${styles.readinessCard} ${readinessClassName}`}>
            <Text size="xs" weight="medium" className={styles.readinessTitle}>
              Ready to use
            </Text>
            <Text size="sm">{authReadiness.title}</Text>
            <Text size="xs" variant="muted">
              {authReadiness.message}
            </Text>
          </div>
        </>
      )}

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Personality</label>
        <Textarea
          aria-label="Personality"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="e.g. Thorough, opinionated, loves clean code"
          rows={2}
        />
      </div>

      {error && (
        <Text variant="muted" size="sm" className={styles.error}>
          {error}
        </Text>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced sub-components (used only in edit / advanced mode)
// ---------------------------------------------------------------------------

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
        <label className={styles.label}>Agent Type</label>
        <div className={styles.runtimeGrid}>
          {(MODEL_RUNTIME_ADAPTERS as readonly string[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.runtimeOption} ${adapterType === t ? styles.runtimeOptionActive : ""}`}
              onClick={() => setAdapterType(t)}
            >
              <span className={styles.choiceTitle}>{getAdapterLabel(t)}</span>
            </button>
          ))}
        </div>
      </div>

      <RunsOnFields
        adapterType={adapterType}
        environment={environment}
        setEnvironment={setEnvironment}
      />
    </>
  );
}

function RunsOnFields({
  adapterType,
  environment,
  setEnvironment,
  compact = false,
  auraLabels = false,
}: {
  adapterType: string;
  environment: string;
  setEnvironment: (v: string) => void;
  compact?: boolean;
  auraLabels?: boolean;
}) {
  return (
    <div className={styles.fieldGroup}>
      {!compact ? <label className={styles.label}>Runs On</label> : null}
      <div className={styles.choiceGrid}>
        <button
          type="button"
          className={`${styles.choiceCard} ${environment === "local_host" ? styles.choiceCardActive : ""}`}
          onClick={() => setEnvironment("local_host")}
        >
          <span className={styles.choiceTitle}>
            <Monitor size={14} />
            {auraLabels ? "Aura Local" : "This Machine"}
          </span>
          <span className={styles.choiceBody}>
            {compact
              ? (auraLabels ? "Aura Local" : "Local")
              : "Run on the local host where Aura OS and your local tools are available."}
          </span>
        </button>
        {adapterType === "aura_harness" ? (
          <button
            type="button"
            className={`${styles.choiceCard} ${environment === "swarm_microvm" ? styles.choiceCardActive : ""}`}
            onClick={() => setEnvironment("swarm_microvm")}
          >
            <span className={styles.choiceTitle}>
              <Cloud size={14} />
              {auraLabels ? "Aura Swarm" : "Cloud"}
            </span>
            <span className={styles.choiceBody}>
              {compact
                ? (auraLabels ? "Aura Swarm" : "Isolated")
                : auraLabels
                  ? "Run on Aura Swarm with Aura-managed billing and credentials."
                  : "Use a stronger isolation boundary for Aura-managed execution."}
            </span>
          </button>
        ) : null}
      </div>
      {!compact && adapterType !== "aura_harness" && (
        <Text variant="muted" size="sm">
          CLI-based runtimes currently run on this machine.
        </Text>
      )}
      {!compact &&
        adapterType === "aura_harness" &&
        environment === "swarm_microvm" && (
          <Text variant="muted" size="sm">
            Isolated Cloud Runtime is the stronger boundary for sensitive
            workloads. The local path is the fully validated path today.
          </Text>
        )}
    </div>
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
  const connectionLabel = getConnectionAuthLabel(adapterType);
  const connectionHint = getConnectionAuthHint(adapterType);

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Credentials</label>
      <div className={styles.choiceGrid} role="radiogroup" aria-label="Credentials">
        {adapterType === "aura_harness" ? (
          <>
            <button
              type="button"
              role="radio"
              aria-checked={authSource === "aura_managed"}
              className={`${styles.choiceCard} ${authSource === "aura_managed" ? styles.choiceCardActive : ""}`}
              onClick={() => setAuthSource("aura_managed")}
            >
              <span className={styles.choiceTitle}>
                Managed by Aura
              </span>
              <span className={styles.choiceBody}>
                Aura provides the credentials and billing for this runtime path.
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={authSource === "org_integration"}
              className={`${styles.choiceCard} ${authSource === "org_integration" ? styles.choiceCardActive : ""}`}
              onClick={() => setAuthSource("org_integration")}
            >
              <span className={styles.choiceTitle}>
                {connectionLabel}
              </span>
              <span className={styles.choiceBody}>{connectionHint}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              role="radio"
              aria-checked={authSource === "local_cli_auth"}
              className={`${styles.choiceCard} ${authSource === "local_cli_auth" ? styles.choiceCardActive : ""}`}
              onClick={() => setAuthSource("local_cli_auth")}
            >
              <span className={styles.choiceTitle}>
                {getLocalAuthLabel(adapterType)}
              </span>
              <span className={styles.choiceBody}>
                Use the local CLI login or shell auth already available on this machine.
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={authSource === "org_integration"}
              className={`${styles.choiceCard} ${authSource === "org_integration" ? styles.choiceCardActive : ""}`}
              onClick={() => setAuthSource("org_integration")}
            >
              <span className={styles.choiceTitle}>
                {connectionLabel}
              </span>
              <span className={styles.choiceBody}>{connectionHint}</span>
            </button>
          </>
        )}
      </div>
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
            className={`${styles.integrationOption} ${integrationId === integration.integration_id ? styles.integrationOptionActive : ""}`}
            onClick={() =>
              setIntegrationId(
                integration.integration_id === integrationId
                  ? ""
                  : integration.integration_id,
              )
            }
          >
            <span className={styles.choiceTitle}>{integration.name}</span>
            <span className={styles.choiceBody}>
              {getIntegrationLabel(integration.provider)}
              {integration.default_model
                ? ` • ${integration.default_model}`
                : ""}
            </span>
            <span className={styles.integrationMeta}>
              {integration.has_secret ? "Key saved" : "No key saved yet"}
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
