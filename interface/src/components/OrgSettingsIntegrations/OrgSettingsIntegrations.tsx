import { useMemo, useState } from "react";
import { Button, Input, Text } from "@cypher-asi/zui";
import type { OrgIntegration } from "../../shared/types";
import {
  getIntegrationConfigFields,
  getIntegrationDefinition,
  getIntegrationKind,
  getIntegrationLabel,
  getSecretLabel,
  getSecretPlaceholder,
  integrationSections,
  supportsDefaultModel,
} from "../../lib/integrationCatalog";
import { isSettingsProviderSelectionEnabled } from "../../lib/featureFlags";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  integrations: OrgIntegration[];
  busyId: string | null;
  canManage: boolean;
  onCreate: (data: {
    name: string;
    provider: string;
    kind?: "workspace_connection" | "workspace_integration" | "mcp_server";
    default_model?: string | null;
    provider_config?: Record<string, unknown> | null;
    api_key?: string | null;
    enabled?: boolean | null;
  }) => Promise<OrgIntegration | null>;
  onUpdate: (
    integrationId: string,
    data: {
      name?: string;
      provider?: string;
      kind?: "workspace_connection" | "workspace_integration" | "mcp_server";
      default_model?: string | null;
      provider_config?: Record<string, unknown> | null;
      api_key?: string | null;
      enabled?: boolean | null;
    },
  ) => Promise<OrgIntegration | null>;
  onDelete: (integrationId: string) => Promise<void>;
}

type IntegrationDraft = {
  name: string;
  provider: string;
  kind: "workspace_connection" | "workspace_integration" | "mcp_server";
  defaultModel: string;
  apiKey: string;
  providerConfig: Record<string, string>;
};

type DraftState = Record<string, IntegrationDraft>;

function providerSupportsModel(provider: string): boolean {
  return supportsDefaultModel(provider);
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

function normalizeDraftPayload(draft: IntegrationDraft) {
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    kind: draft.kind,
    default_model: providerSupportsModel(draft.provider) ? (draft.defaultModel.trim() || null) : null,
    provider_config: normalizeProviderConfig(draft.provider, draft.providerConfig),
    api_key: draft.apiKey.trim() || null,
  };
}

function providerDescription(provider: string): string {
  return getIntegrationDefinition(provider)?.description ?? "Shared workspace capability.";
}

function providerAuthHint(provider: string): string | null {
  return getIntegrationDefinition(provider)?.authHint ?? null;
}

function kindLabel(kind: OrgIntegration["kind"]): string {
  if (kind === "workspace_connection") return "Workspace Connection";
  if (kind === "workspace_integration") return "Workspace Integration";
  return "MCP Server";
}

function supportsCapabilityToggle(kind: OrgIntegration["kind"]): boolean {
  return kind === "workspace_integration" || kind === "mcp_server";
}

function emptyDraft(provider: string): IntegrationDraft {
  return {
    name: "",
    provider,
    kind: getIntegrationKind(provider),
    defaultModel: "",
    apiKey: "",
    providerConfig: {},
  };
}

export function OrgSettingsIntegrations({
  integrations,
  busyId,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [drafts, setDrafts] = useState<DraftState>({});
  const [newIntegration, setNewIntegration] = useState<IntegrationDraft | null>(null);
  const [expandedIntegrationId, setExpandedIntegrationId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mergedDrafts = useMemo(() => {
    const next: DraftState = { ...drafts };
    for (const integration of integrations) {
      next[integration.integration_id] ??= {
        name: integration.name,
        provider: integration.provider,
        kind: integration.kind,
        defaultModel: integration.default_model ?? "",
        apiKey: "",
        providerConfig: stringConfig(integration.provider_config ?? undefined),
      };
    }
    return next;
  }, [drafts, integrations]);

  const sections = integrationSections();
  const newProvider = newIntegration ? getIntegrationDefinition(newIntegration.provider) : undefined;
  const newSupportsModel = newIntegration ? providerSupportsModel(newIntegration.provider) : false;
  const newSecretLabel = newIntegration ? getSecretLabel(newIntegration.provider) : "API Key";
  const newSecretPlaceholder = newIntegration ? getSecretPlaceholder(newIntegration.provider) : "Paste the API key";
  const newAuthHint = newIntegration ? providerAuthHint(newIntegration.provider) : null;
  const newConfigFields = newIntegration ? getIntegrationConfigFields(newIntegration.provider) : [];

  return (
    <div>
      <h2 className={styles.sectionTitle}>Integrations</h2>

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

      {isCreating && (
        <>
        <div className={styles.settingsGroupLabel}>New Integration</div>
        <div className={styles.settingsGroup}>
          <div className={`${styles.formRow} ${styles.integrationRow}`}>
            {!newIntegration ? (
              <div className={styles.integrationFields}>
                <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                  <ProviderButtons
                    value=""
                    onChange={(provider) => setNewIntegration(emptyDraft(provider))}
                    showSectionDescriptions={false}
                    compact
                  />
                </div>
              </div>
            ) : (
              <div className={styles.integrationFields}>
                <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                  <span className={styles.integrationFieldLabel}>Provider</span>
                  <div className={styles.integrationSelectionRow}>
                    <div className={styles.integrationBadgeRow}>
                      <span className={styles.integrationBadge}>{newProvider?.label ?? newIntegration.provider}</span>
                      <span className={styles.integrationBadge}>{kindLabel(newIntegration.kind)}</span>
                    </div>
                    <Button variant="ghost" onClick={() => setNewIntegration(null)}>
                      Change
                    </Button>
                  </div>
                  {newAuthHint ? (
                    <Text size="xs" variant="muted">{newAuthHint}</Text>
                  ) : null}
                </div>
                <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                  <label className={styles.integrationFieldLabel} htmlFor="new-integration-name">Name</label>
                  <Input
                    id="new-integration-name"
                    aria-label="New integration name"
                    value={newIntegration.name}
                    onChange={(e) => setNewIntegration((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                    placeholder={`e.g. ${newProvider?.label ?? "Provider"} Production`}
                  />
                </div>
                <div className={`${styles.integrationFieldGroup} ${newSupportsModel || newConfigFields.length > 0 ? "" : styles.integrationFieldGroupFull}`}>
                  <label className={styles.integrationFieldLabel} htmlFor="new-integration-key">{newSecretLabel}</label>
                  <Input
                    id="new-integration-key"
                    aria-label={`New ${newSecretLabel}`}
                    type="password"
                    value={newIntegration.apiKey}
                    onChange={(e) => setNewIntegration((prev) => prev ? { ...prev, apiKey: e.target.value } : prev)}
                    placeholder={newSecretPlaceholder}
                  />
                </div>
                {(newSupportsModel || newConfigFields.length > 0) && (
                  <details className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull} ${styles.integrationAdvanced}`}>
                    <summary className={styles.integrationAdvancedSummary}>Advanced</summary>
                    <div className={styles.integrationAdvancedBody}>
                      {newSupportsModel && (
                        <div className={styles.integrationFieldGroup}>
                          <label className={styles.integrationFieldLabel} htmlFor="new-integration-model">Preferred Model</label>
                          <Input
                            id="new-integration-model"
                            aria-label="New preferred model"
                            value={newIntegration.defaultModel}
                            onChange={(e) => setNewIntegration((prev) => prev ? { ...prev, defaultModel: e.target.value } : prev)}
                            placeholder="Optional preferred model"
                          />
                        </div>
                      )}
                      {newConfigFields.map((field) => (
                        <div key={field.key} className={styles.integrationFieldGroup}>
                          <label className={styles.integrationFieldLabel} htmlFor={`new-config-${field.key}`}>{field.label}</label>
                          <Input
                            id={`new-config-${field.key}`}
                            aria-label={`New ${field.label}`}
                            value={newIntegration.providerConfig[field.key] ?? ""}
                            onChange={(e) => setNewIntegration((prev) => prev ? {
                              ...prev,
                              providerConfig: { ...prev.providerConfig, [field.key]: e.target.value },
                            } : prev)}
                            placeholder={field.placeholder}
                          />
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <div className={styles.integrationActions}>
                  <Button variant="ghost" onClick={() => { setIsCreating(false); setNewIntegration(null); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (!newIntegration.name.trim()) return;
                      setErrorMessage(null);
                      try {
                        await onCreate(normalizeDraftPayload(newIntegration));
                        setNewIntegration(null);
                        setIsCreating(false);
                      } catch (error) {
                        setErrorMessage(
                          error instanceof Error ? error.message : "Failed to create integration",
                        );
                      }
                    }}
                    disabled={busyId === "new" || !canManage}
                  >
                    {busyId === "new" ? "Saving..." : "Add"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {sections.map((section) => {
        const sectionIntegrations = integrations.filter((integration) => integration.kind === section.id);
        return (
          <div key={section.id}>
            <div className={styles.settingsGroupLabel}>{section.title}</div>
            <div className={styles.settingsGroup}>
            {sectionIntegrations.length === 0 ? (
              <div className={styles.emptyMessage}>No {section.title.toLowerCase()} yet.</div>
            ) : (
              sectionIntegrations.map((integration) => {
                const draft = mergedDrafts[integration.integration_id];
                const isBusy = busyId === integration.integration_id;
                const supportsModel = providerSupportsModel(draft.provider);
                const secretLabel = getSecretLabel(draft.provider);
                const secretPlaceholder = getSecretPlaceholder(draft.provider);
                const authHint = providerAuthHint(draft.provider);
                const configFields = getIntegrationConfigFields(draft.provider);
                const isExpanded = expandedIntegrationId === integration.integration_id;
                const configCount = Object.values(draft.providerConfig)
                  .filter((value) => value.trim().length > 0)
                  .length;
                const secondaryBadge = draft.defaultModel
                  ? draft.defaultModel
                  : configCount > 0
                    ? `${configCount} config field${configCount === 1 ? "" : "s"}`
                    : null;

                return (
                  <div key={integration.integration_id} className={`${styles.formRow} ${styles.integrationRow}`}>
                    <div className={styles.integrationSummary}>
                      <div className={styles.integrationMeta}>
                        <div className={styles.integrationHeader}>{integration.name}</div>
                        <div className={styles.integrationBadgeRow}>
                          <span className={styles.integrationBadge}>{getIntegrationLabel(integration.provider)}</span>
                          <span className={styles.integrationBadge}>
                            {integration.secret_last4 ? `Key ••••${integration.secret_last4}` : "No key"}
                          </span>
                          {supportsCapabilityToggle(integration.kind) && (
                            <span className={styles.integrationBadge}>
                              {integration.enabled ? "Enabled" : "Disabled"}
                            </span>
                          )}
                          {secondaryBadge && (
                            <span className={styles.integrationBadge}>{secondaryBadge}</span>
                          )}
                        </div>
                      </div>
                      <div className={styles.integrationSummaryActions}>
                        {supportsCapabilityToggle(integration.kind) && (
                          <Button
                            variant="ghost"
                            onClick={async () => {
                              setErrorMessage(null);
                              try {
                                await onUpdate(integration.integration_id, {
                                  enabled: !integration.enabled,
                                });
                              } catch (error) {
                                setErrorMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Failed to update integration",
                                );
                              }
                            }}
                            disabled={isBusy || !canManage}
                          >
                            {integration.enabled ? "Disable" : "Enable"}
                          </Button>
                        )}
                        <Button
                          variant={isExpanded ? "ghost" : "primary"}
                          onClick={() => setExpandedIntegrationId((current) => (
                            current === integration.integration_id ? null : integration.integration_id
                          ))}
                          disabled={isBusy || (!canManage && !isExpanded)}
                        >
                          {isExpanded ? "Close" : "Edit"}
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className={`${styles.integrationFields} ${styles.integrationEditor}`}>
                        <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                          <label className={styles.integrationFieldLabel} htmlFor={`integration-name-${integration.integration_id}`}>Name</label>
                          <Input
                            id={`integration-name-${integration.integration_id}`}
                            aria-label={`Integration name for ${integration.name}`}
                            value={draft.name}
                            onChange={(e) => setDrafts((prev) => ({
                              ...prev,
                              [integration.integration_id]: { ...draft, name: e.target.value },
                            }))}
                            placeholder="Integration name…"
                          />
                        </div>
                        <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                          <span className={styles.integrationFieldLabel}>Provider</span>
                          <div className={styles.integrationSelectionRow}>
                            <div className={styles.integrationBadgeRow}>
                              <span className={styles.integrationBadge}>{getIntegrationLabel(draft.provider)}</span>
                              <span className={styles.integrationBadge}>{kindLabel(integration.kind)}</span>
                            </div>
                          </div>
                          <Text size="xs" variant="muted">{providerDescription(draft.provider)}</Text>
                        </div>
                        <div className={`${styles.integrationFieldGroup} ${supportsModel || configFields.length > 0 ? "" : styles.integrationFieldGroupFull}`}>
                          <label className={styles.integrationFieldLabel} htmlFor={`integration-key-${integration.integration_id}`}>{secretLabel}</label>
                          <Input
                            id={`integration-key-${integration.integration_id}`}
                            aria-label={`${secretLabel} for ${integration.name}`}
                            type="password"
                            value={draft.apiKey}
                            onChange={(e) => setDrafts((prev) => ({
                              ...prev,
                              [integration.integration_id]: { ...draft, apiKey: e.target.value },
                            }))}
                            placeholder={integration.has_secret ? "Leave blank to keep the existing secret" : secretPlaceholder}
                          />
                          {authHint && <Text size="xs" variant="muted">{authHint}</Text>}
                        </div>
                        {(supportsModel || configFields.length > 0) && (
                          <details className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull} ${styles.integrationAdvanced}`}>
                            <summary className={styles.integrationAdvancedSummary}>Advanced</summary>
                            <div className={styles.integrationAdvancedBody}>
                              {supportsModel && (
                                <div className={styles.integrationFieldGroup}>
                                  <label className={styles.integrationFieldLabel} htmlFor={`integration-model-${integration.integration_id}`}>Preferred Model</label>
                                  <Input
                                    id={`integration-model-${integration.integration_id}`}
                                    aria-label={`Preferred model for ${integration.name}`}
                                    value={draft.defaultModel}
                                    onChange={(e) => setDrafts((prev) => ({
                                      ...prev,
                                      [integration.integration_id]: { ...draft, defaultModel: e.target.value },
                                    }))}
                                    placeholder="Optional preferred model"
                                  />
                                </div>
                              )}
                              {configFields.map((field) => (
                                <div key={`${integration.integration_id}-${field.key}`} className={styles.integrationFieldGroup}>
                                  <label className={styles.integrationFieldLabel} htmlFor={`${integration.integration_id}-${field.key}`}>{field.label}</label>
                                  <Input
                                    id={`${integration.integration_id}-${field.key}`}
                                    aria-label={`${field.label} for ${integration.name}`}
                                    value={draft.providerConfig[field.key] ?? ""}
                                    onChange={(e) => setDrafts((prev) => ({
                                      ...prev,
                                      [integration.integration_id]: {
                                        ...draft,
                                        providerConfig: {
                                          ...draft.providerConfig,
                                          [field.key]: e.target.value,
                                        },
                                      },
                                    }))}
                                    placeholder={field.placeholder}
                                  />
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        <div className={styles.integrationActions}>
                          <Button
                            variant="ghost"
                            onClick={async () => {
                              const confirmed = window.confirm(`Delete "${integration.name}"?`);
                              if (!confirmed) return;
                              setErrorMessage(null);
                              try {
                                await onDelete(integration.integration_id);
                              } catch (error) {
                                setErrorMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Failed to delete integration",
                                );
                              }
                            }}
                            disabled={isBusy || !canManage}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="primary"
                            onClick={async () => {
                              setErrorMessage(null);
                              try {
                                await onUpdate(
                                  integration.integration_id,
                                  normalizeDraftPayload(draft),
                                );
                              } catch (error) {
                                setErrorMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Failed to update integration",
                                );
                              }
                            }}
                            disabled={isBusy || !canManage}
                          >
                            {isBusy ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            </div>
          </div>
        );
      })}

      {canManage && (
        <>
          <div className={styles.settingsGroupLabel}>Actions</div>
          <div className={styles.settingsGroup}>
            <div className={styles.inviteActions}>
              <Button
                variant={isCreating ? "ghost" : "primary"}
                size="sm"
                onClick={() => {
                  setErrorMessage(null);
                  setIsCreating((current) => !current);
                  setNewIntegration(null);
                }}
              >
                {isCreating ? "Close" : "Add Integration"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ProviderButtons({
  value,
  onChange,
  showSectionDescriptions = true,
  compact = false,
}: {
  value: string;
  onChange: (provider: string) => void;
  showSectionDescriptions?: boolean;
  compact?: boolean;
}) {
  const sections = integrationSections().filter(
    (section) => section.id !== "workspace_connection" || isSettingsProviderSelectionEnabled(),
  );

  return (
    <div className={styles.integrationProviderSections}>
      {sections.map((section) => (
        <div key={section.id} className={styles.integrationProviderSection}>
          <div className={styles.integrationProviderSectionHeader}>
            <span className={styles.providerSectionTitle}>{section.title}</span>
            {showSectionDescriptions && <Text size="xs" variant="muted">{section.description}</Text>}
          </div>
          <div className={styles.providerCardGrid}>
            {section.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                aria-label={provider.label}
                className={`${styles.providerCard} ${value === provider.id ? styles.providerCardActive : ""}`}
                onClick={() => onChange(provider.id)}
                title={provider.description}
              >
                <span className={styles.providerCardTitle}>{provider.label}</span>
                <span className={styles.providerCardMeta}>
                  {provider.kind === "workspace_connection"
                    ? "Shared model access"
                    : provider.kind === "workspace_integration"
                      ? "Workspace app tools"
                      : "External MCP tools"}
                </span>
                {!compact ? (
                  <span className={styles.providerCardBody}>{provider.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
