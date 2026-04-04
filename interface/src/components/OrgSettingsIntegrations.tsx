import { useMemo, useState } from "react";
import { Button, Input, Text } from "@cypher-asi/zui";
import type { OrgIntegration } from "../types";
import {
  getIntegrationDefinition,
  getIntegrationLabel,
  getSecretLabel,
  getSecretPlaceholder,
  integrationSections,
  supportsDefaultModel,
} from "../lib/integrationCatalog";
import styles from "./OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  integrations: OrgIntegration[];
  busyId: string | null;
  onCreate: (data: {
    name: string;
    provider: string;
    default_model?: string | null;
    api_key?: string | null;
  }) => Promise<OrgIntegration | null>;
  onUpdate: (
    integrationId: string,
    data: {
      name?: string;
      provider?: string;
      default_model?: string | null;
      api_key?: string | null;
    },
  ) => Promise<OrgIntegration | null>;
  onDelete: (integrationId: string) => Promise<void>;
}

type IntegrationDraft = {
  name: string;
  provider: string;
  defaultModel: string;
  apiKey: string;
};

type DraftState = Record<string, IntegrationDraft>;

const DEFAULT_PROVIDER = "anthropic";

function providerSupportsModel(provider: string): boolean {
  return supportsDefaultModel(provider);
}

function normalizeDraftPayload(draft: IntegrationDraft) {
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    default_model: providerSupportsModel(draft.provider) ? (draft.defaultModel.trim() || null) : null,
    api_key: draft.apiKey.trim() || null,
  };
}

function providerDescription(provider: string): string {
  return getIntegrationDefinition(provider)?.description ?? "Shared org-level integration.";
}

function providerAuthHint(provider: string): string | null {
  return getIntegrationDefinition(provider)?.authHint ?? null;
}

export function OrgSettingsIntegrations({ integrations, busyId, onCreate, onUpdate, onDelete }: Props) {
  const [drafts, setDrafts] = useState<DraftState>({});
  const [newIntegration, setNewIntegration] = useState<IntegrationDraft>({
    name: "",
    provider: DEFAULT_PROVIDER,
    defaultModel: "",
    apiKey: "",
  });

  const mergedDrafts = useMemo(() => {
    const next: DraftState = { ...drafts };
    for (const integration of integrations) {
      next[integration.integration_id] ??= {
        name: integration.name,
        provider: integration.provider,
        defaultModel: integration.default_model ?? "",
        apiKey: "",
      };
    }
    return next;
  }, [drafts, integrations]);

  const newProvider = getIntegrationDefinition(newIntegration.provider);
  const newSecretLabel = getSecretLabel(newIntegration.provider);
  const newSecretPlaceholder = getSecretPlaceholder(newIntegration.provider);
  const newSupportsModel = providerSupportsModel(newIntegration.provider);
  const newAuthHint = providerAuthHint(newIntegration.provider);

  return (
    <div>
      <h2 className={styles.sectionTitle}>Integrations</h2>
      <p className={styles.sectionIntro}>
        Manage shared integrations for this team. Model vendors and org-level tool connections
        both live here, while only runtime-compatible model providers appear in agent auth flows today.
      </p>

      <div className={styles.settingsGroup}>
        <div className={styles.settingsGroupLabel}>Create Integration</div>
        <div className={`${styles.formRow} ${styles.integrationRow}`}>
          <div className={styles.integrationMeta}>
            <div className={styles.integrationHeader}>New integration</div>
            <div className={styles.integrationHint}>
              Save shared credentials once for the whole team, then reuse them across agents and future tool workflows.
            </div>
          </div>
          <div className={styles.integrationFields}>
            <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
              <label className={styles.integrationFieldLabel} htmlFor="new-integration-name">Integration Name</label>
              <Input
                id="new-integration-name"
                aria-label="New integration name"
                value={newIntegration.name}
                onChange={(e) => setNewIntegration((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={`e.g. ${newProvider?.label ?? "Provider"} Production`}
              />
            </div>
            <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
              <span className={styles.integrationFieldLabel}>Provider</span>
              <ProviderButtons
                value={newIntegration.provider}
                onChange={(provider) => setNewIntegration((prev) => ({ ...prev, provider }))}
              />
              <Text size="xs" variant="muted">
                {providerDescription(newIntegration.provider)}
              </Text>
            </div>
            {newSupportsModel && (
              <div className={styles.integrationFieldGroup}>
                <label className={styles.integrationFieldLabel} htmlFor="new-integration-model">Preferred Model</label>
                <Input
                  id="new-integration-model"
                  aria-label="New preferred model"
                  value={newIntegration.defaultModel}
                  onChange={(e) => setNewIntegration((prev) => ({ ...prev, defaultModel: e.target.value }))}
                  placeholder="Optional preferred model"
                />
              </div>
            )}
            <div className={`${styles.integrationFieldGroup} ${newSupportsModel ? "" : styles.integrationFieldGroupFull}`}>
              <label className={styles.integrationFieldLabel} htmlFor="new-integration-key">{newSecretLabel}</label>
              <Input
                id="new-integration-key"
                aria-label={`New ${newSecretLabel}`}
                type="password"
                value={newIntegration.apiKey}
                onChange={(e) => setNewIntegration((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={newSecretPlaceholder}
              />
              {newAuthHint && (
                <Text size="xs" variant="muted">
                  {newAuthHint}
                </Text>
              )}
            </div>
            <div className={styles.integrationActions}>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!newIntegration.name.trim()) return;
                  await onCreate(normalizeDraftPayload(newIntegration));
                  setNewIntegration({
                    name: "",
                    provider: newIntegration.provider,
                    defaultModel: "",
                    apiKey: "",
                  });
                }}
                disabled={busyId === "new"}
              >
                {busyId === "new" ? "Saving..." : "Add Integration"}
              </Button>
            </div>
            {!newIntegration.apiKey.trim() && (
              <Text size="xs" variant="muted">
                You can save this without a secret while setting things up, but it will stay unavailable until a key or token is added.
              </Text>
            )}
          </div>
        </div>
      </div>

      <div className={styles.settingsGroup}>
        <div className={styles.settingsGroupLabel}>Saved Integrations</div>
        {integrations.length === 0 ? (
          <div className={styles.emptyMessage}>No integrations yet. Add one above to share provider keys and org tokens across agents.</div>
        ) : (
          integrations.map((integration) => {
            const draft = mergedDrafts[integration.integration_id];
            const isBusy = busyId === integration.integration_id;
            const definition = getIntegrationDefinition(draft.provider);
            const supportsModel = providerSupportsModel(draft.provider);
            const secretLabel = getSecretLabel(draft.provider);
            const secretPlaceholder = getSecretPlaceholder(draft.provider);
            const authHint = providerAuthHint(draft.provider);

            return (
              <div key={integration.integration_id} className={`${styles.formRow} ${styles.integrationRow}`}>
                <div className={styles.integrationMeta}>
                  <div className={styles.integrationHeader}>{integration.name}</div>
                  <div className={styles.integrationHint}>
                    {getIntegrationLabel(integration.provider)}
                    {integration.secret_last4 ? ` • secret ending in ${integration.secret_last4}` : " • no secret saved"}
                  </div>
                  <Text size="xs" variant="muted">
                    {definition?.description ?? "Shared org-level integration."}
                  </Text>
                </div>
                <div className={styles.integrationFields}>
                  <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                    <label className={styles.integrationFieldLabel} htmlFor={`integration-name-${integration.integration_id}`}>Integration Name</label>
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
                    <ProviderButtons
                      value={draft.provider}
                      onChange={(provider) => setDrafts((prev) => ({
                        ...prev,
                        [integration.integration_id]: { ...draft, provider },
                      }))}
                    />
                  </div>
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
                  <div className={`${styles.integrationFieldGroup} ${supportsModel ? "" : styles.integrationFieldGroupFull}`}>
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
                    {authHint && (
                      <Text size="xs" variant="muted">
                        {authHint}
                      </Text>
                    )}
                  </div>
                  <div className={styles.integrationActions}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Delete integration "${integration.name}"? Agents using Team Integration will need a different authentication setup before they can run again.`,
                        );
                        if (!confirmed) return;
                        void onDelete(integration.integration_id);
                      }}
                      disabled={isBusy}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => onUpdate(integration.integration_id, normalizeDraftPayload(draft))}
                      disabled={isBusy}
                    >
                      {isBusy ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Text size="xs" variant="muted">
        Team-level secrets stay at the org integration layer. Runtime auth only shows the model providers each runtime can actually use today.
      </Text>
    </div>
  );
}

function ProviderButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (provider: string) => void;
}) {
  const sections = integrationSections();

  return (
    <div className={styles.integrationProviderSections}>
      {sections.map((section) => (
        <div key={section.id} className={styles.integrationProviderSection}>
          <div className={styles.integrationProviderSectionHeader}>
            <span>{section.title}</span>
            <Text size="xs" variant="muted">{section.description}</Text>
          </div>
          <div className={styles.machineTypeToggle}>
            {section.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`${styles.machineTypeOption} ${value === provider.id ? styles.machineTypeActive : ""}`}
                onClick={() => onChange(provider.id)}
                title={provider.description}
              >
                {provider.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
