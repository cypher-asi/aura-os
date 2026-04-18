import { useEffect, useMemo, useState } from "react";
import { Button, Input, Text } from "@cypher-asi/zui";
import type { OrgIntegration } from "../../types";
import {
  getIntegrationConfigFields,
  getIntegrationDefinition,
  getIntegrationLabel,
  getSecretLabel,
  getSecretPlaceholder,
  supportsDefaultModel,
} from "../../lib/integrationCatalog";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

type IntegrationKind = OrgIntegration["kind"];

export interface IntegrationEditorPayload {
  name: string;
  provider: string;
  kind: IntegrationKind;
  default_model: string | null;
  provider_config: Record<string, unknown> | null;
  api_key: string | null;
}

export interface IntegrationEditorProps {
  /** Provider id from the integration catalog this editor targets. */
  provider: string;
  /** Existing org integration for this provider (if any). */
  integration: OrgIntegration | null;
  canManage: boolean;
  /** When matches the integration id (or "new" for the create flow) the editor shows a saving state. */
  busyId: string | null;
  onCreate: (payload: IntegrationEditorPayload) => Promise<OrgIntegration | null>;
  onUpdate: (
    integrationId: string,
    payload: Partial<IntegrationEditorPayload> & { enabled?: boolean | null },
  ) => Promise<OrgIntegration | null>;
  onDelete: (integrationId: string) => Promise<void>;
}

interface Draft {
  name: string;
  defaultModel: string;
  apiKey: string;
  providerConfig: Record<string, string>;
}

function stringConfig(config: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!config) return {};
  return Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : String(value)]),
  );
}

function normalizeProviderConfig(provider: string, values: Record<string, string>) {
  const fields = getIntegrationConfigFields(provider);
  if (fields.length === 0) return null;

  const config: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key]?.trim();
    if (!raw) continue;
    if (field.key === "args") {
      config[field.key] = raw.split(/\s+/).filter(Boolean);
    } else {
      config[field.key] = raw;
    }
  }

  return Object.keys(config).length > 0 ? config : null;
}

function kindLabel(kind: IntegrationKind): string {
  if (kind === "workspace_connection") return "Workspace Connection";
  if (kind === "workspace_integration") return "Workspace Integration";
  return "MCP Server";
}

function supportsCapabilityToggle(kind: IntegrationKind): boolean {
  return kind === "workspace_integration" || kind === "mcp_server";
}

function emptyDraft(integration: OrgIntegration | null, defaultName: string): Draft {
  return {
    name: integration?.name ?? defaultName,
    defaultModel: integration?.default_model ?? "",
    apiKey: "",
    providerConfig: stringConfig(integration?.provider_config ?? undefined),
  };
}

/**
 * Presentational editor for a single integration provider. Owns its own draft
 * state so it can be dropped into either the Team Settings modal or the
 * Integrations app without the parent needing to wire up the same form
 * scaffolding twice.
 */
export function IntegrationEditor({
  provider,
  integration,
  canManage,
  busyId,
  onCreate,
  onUpdate,
  onDelete,
}: IntegrationEditorProps) {
  const definition = getIntegrationDefinition(provider);
  const kind: IntegrationKind = definition?.kind ?? "workspace_connection";
  const secretLabel = getSecretLabel(provider);
  const secretPlaceholder = getSecretPlaceholder(provider);
  const authHint = definition?.authHint ?? null;
  const description = definition?.description ?? "Shared workspace capability.";
  const docsUrl = definition?.docsUrl ?? null;
  const configFields = useMemo(() => getIntegrationConfigFields(provider), [provider]);
  const showModel = supportsDefaultModel(provider);

  const [draft, setDraft] = useState<Draft>(() => emptyDraft(integration, definition?.label ?? provider));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset the draft when the selected provider or underlying integration
  // changes (including after a create/delete flips `integration` to/from null).
  useEffect(() => {
    setDraft(emptyDraft(integration, definition?.label ?? provider));
    setErrorMessage(null);
  }, [integration, provider, definition?.label]);

  const isNew = integration === null;
  const busyKey = isNew ? "new" : integration?.integration_id;
  const isBusy = busyId !== null && busyKey !== undefined && busyId === busyKey;

  const handleSave = async () => {
    if (!canManage) return;
    if (!draft.name.trim()) {
      setErrorMessage("Integration name is required.");
      return;
    }
    setErrorMessage(null);
    const payload: IntegrationEditorPayload = {
      name: draft.name.trim(),
      provider,
      kind,
      default_model: showModel ? (draft.defaultModel.trim() || null) : null,
      provider_config: normalizeProviderConfig(provider, draft.providerConfig),
      api_key: draft.apiKey.trim() || null,
    };
    try {
      if (isNew) {
        await onCreate(payload);
      } else {
        await onUpdate(integration.integration_id, payload);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save integration",
      );
    }
  };

  const handleToggleEnabled = async () => {
    if (!integration || !canManage) return;
    setErrorMessage(null);
    try {
      await onUpdate(integration.integration_id, { enabled: !integration.enabled });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update integration",
      );
    }
  };

  const handleDelete = async () => {
    if (!integration || !canManage) return;
    const confirmed = window.confirm(`Delete "${integration.name}"?`);
    if (!confirmed) return;
    setErrorMessage(null);
    try {
      await onDelete(integration.integration_id);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to delete integration",
      );
    }
  };

  const keyPlaceholder = integration?.has_secret
    ? "Leave blank to keep the existing secret"
    : secretPlaceholder;

  return (
    <div>
      <h2 className={styles.sectionTitle}>{getIntegrationLabel(provider)}</h2>
      <Text size="xs" variant="muted">{description}</Text>
      {docsUrl ? (
        <div className={styles.topMarginSm}>
          <a href={docsUrl} target="_blank" rel="noreferrer" className={styles.integrationHint}>
            View provider docs
          </a>
        </div>
      ) : null}

      {!canManage ? (
        <Text size="xs" variant="muted">
          Only team admins and owners can add, edit, or delete integrations.
        </Text>
      ) : null}

      {errorMessage ? (
        <Text size="xs" style={{ color: "var(--color-danger-500)" }}>
          {errorMessage}
        </Text>
      ) : null}

      <div className={styles.settingsGroupLabel}>
        {isNew ? "New Integration" : "Details"}
      </div>
      <div className={styles.settingsGroup}>
        <div className={`${styles.formRow} ${styles.integrationRow}`}>
          {integration ? (
            <div className={styles.integrationSummary}>
              <div className={styles.integrationMeta}>
                <div className={styles.integrationHeader}>{integration.name}</div>
                <div className={styles.integrationBadgeRow}>
                  <span className={styles.integrationBadge}>{getIntegrationLabel(integration.provider)}</span>
                  <span className={styles.integrationBadge}>{kindLabel(integration.kind)}</span>
                  <span className={styles.integrationBadge}>
                    {integration.secret_last4 ? `Key ••••${integration.secret_last4}` : "No key"}
                  </span>
                  {supportsCapabilityToggle(integration.kind) && (
                    <span className={styles.integrationBadge}>
                      {integration.enabled ? "Enabled" : "Disabled"}
                    </span>
                  )}
                </div>
              </div>
              {supportsCapabilityToggle(integration.kind) && (
                <div className={styles.integrationSummaryActions}>
                  <Button
                    variant="ghost"
                    onClick={handleToggleEnabled}
                    disabled={isBusy || !canManage}
                  >
                    {integration.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          <div className={`${styles.integrationFields} ${integration ? styles.integrationEditor : ""}`}>
            <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
              <label className={styles.integrationFieldLabel} htmlFor={`integration-name-${provider}`}>Name</label>
              <Input
                id={`integration-name-${provider}`}
                aria-label={`Integration name for ${getIntegrationLabel(provider)}`}
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={`e.g. ${definition?.label ?? "Provider"} Production`}
              />
            </div>
            <div className={`${styles.integrationFieldGroup} ${showModel || configFields.length > 0 ? "" : styles.integrationFieldGroupFull}`}>
              <label className={styles.integrationFieldLabel} htmlFor={`integration-key-${provider}`}>{secretLabel}</label>
              <Input
                id={`integration-key-${provider}`}
                aria-label={`${secretLabel} for ${getIntegrationLabel(provider)}`}
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={keyPlaceholder}
              />
              {authHint && <Text size="xs" variant="muted">{authHint}</Text>}
            </div>
            {(showModel || configFields.length > 0) && (
              <details className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull} ${styles.integrationAdvanced}`}>
                <summary className={styles.integrationAdvancedSummary}>Advanced</summary>
                <div className={styles.integrationAdvancedBody}>
                  {showModel && (
                    <div className={styles.integrationFieldGroup}>
                      <label className={styles.integrationFieldLabel} htmlFor={`integration-model-${provider}`}>Preferred Model</label>
                      <Input
                        id={`integration-model-${provider}`}
                        aria-label={`Preferred model for ${getIntegrationLabel(provider)}`}
                        value={draft.defaultModel}
                        onChange={(e) => setDraft((prev) => ({ ...prev, defaultModel: e.target.value }))}
                        placeholder="Optional preferred model"
                      />
                    </div>
                  )}
                  {configFields.map((field) => (
                    <div key={field.key} className={styles.integrationFieldGroup}>
                      <label className={styles.integrationFieldLabel} htmlFor={`integration-${provider}-${field.key}`}>{field.label}</label>
                      <Input
                        id={`integration-${provider}-${field.key}`}
                        aria-label={`${field.label} for ${getIntegrationLabel(provider)}`}
                        value={draft.providerConfig[field.key] ?? ""}
                        onChange={(e) => setDraft((prev) => ({
                          ...prev,
                          providerConfig: { ...prev.providerConfig, [field.key]: e.target.value },
                        }))}
                        placeholder={field.placeholder}
                      />
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className={styles.integrationActions}>
              {integration ? (
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={isBusy || !canManage}
                >
                  Delete
                </Button>
              ) : null}
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={isBusy || !canManage}
              >
                {isBusy ? "Saving..." : integration ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
