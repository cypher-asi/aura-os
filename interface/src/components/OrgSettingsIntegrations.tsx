import { useMemo, useState } from "react";
import { Button, Input, Text } from "@cypher-asi/zui";
import type { OrgIntegration } from "../types";
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

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
];

type DraftState = Record<string, {
  name: string;
  provider: string;
  defaultModel: string;
  apiKey: string;
}>;

export function OrgSettingsIntegrations({ integrations, busyId, onCreate, onUpdate, onDelete }: Props) {
  const [drafts, setDrafts] = useState<DraftState>({});
  const [newIntegration, setNewIntegration] = useState({
    name: "",
    provider: "anthropic",
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

  return (
    <div>
      <h2 className={styles.sectionTitle}>Integrations</h2>
      <p className={styles.sectionIntro}>
        Manage shared provider connections for this organization. Create a new integration below,
        then attach the right one to an agent only when that runtime should use org-managed auth.
      </p>

      <div className={styles.settingsGroup}>
        <div className={styles.settingsGroupLabel}>Create New Integration</div>
        <div className={`${styles.formRow} ${styles.integrationRow}`}>
          <div className={styles.integrationMeta}>
            <div className={styles.integrationHeader}>New integration</div>
            <div className={styles.integrationHint}>
              Store reusable provider credentials once at the organization level, then attach them only where API-backed runtime auth is needed.
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
                placeholder="e.g. Anthropic Prod…"
              />
            </div>
            <div className={styles.integrationFieldGroup}>
              <span className={styles.integrationFieldLabel}>Provider</span>
              <ProviderButtons
                value={newIntegration.provider}
                onChange={(provider) => setNewIntegration((prev) => ({ ...prev, provider }))}
              />
            </div>
            <div className={styles.integrationFieldGroup}>
              <label className={styles.integrationFieldLabel} htmlFor="new-integration-model">Default Model</label>
              <Input
                id="new-integration-model"
                aria-label="New default model"
                value={newIntegration.defaultModel}
                onChange={(e) => setNewIntegration((prev) => ({ ...prev, defaultModel: e.target.value }))}
                placeholder="Optional model override…"
              />
            </div>
            <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
              <label className={styles.integrationFieldLabel} htmlFor="new-integration-key">API Key</label>
              <Input
                id="new-integration-key"
                aria-label="New API key"
                type="password"
                value={newIntegration.apiKey}
                onChange={(e) => setNewIntegration((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder="Paste the provider key…"
              />
            </div>
            <div className={styles.integrationActions}>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!newIntegration.name.trim()) return;
                  await onCreate({
                    name: newIntegration.name.trim(),
                    provider: newIntegration.provider,
                    default_model: newIntegration.defaultModel.trim() || null,
                    api_key: newIntegration.apiKey.trim() || null,
                  });
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
          </div>
        </div>
      </div>

      <div className={styles.settingsGroup}>
        <div className={styles.settingsGroupLabel}>Saved Integrations</div>
        {integrations.length === 0 ? (
          <div className={styles.emptyMessage}>No integrations yet.</div>
        ) : (
          integrations.map((integration) => {
            const draft = mergedDrafts[integration.integration_id];
            const isBusy = busyId === integration.integration_id;
            return (
              <div key={integration.integration_id} className={`${styles.formRow} ${styles.integrationRow}`}>
                <div className={styles.integrationMeta}>
                  <div className={styles.integrationHeader}>{integration.name}</div>
                  <div className={styles.integrationHint}>
                    {integration.provider}
                    {integration.secret_last4 ? ` • key ending in ${integration.secret_last4}` : " • no key saved"}
                  </div>
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
                  <div className={styles.integrationFieldGroup}>
                    <span className={styles.integrationFieldLabel}>Provider</span>
                    <ProviderButtons
                      value={draft.provider}
                      onChange={(provider) => setDrafts((prev) => ({
                        ...prev,
                        [integration.integration_id]: { ...draft, provider },
                      }))}
                    />
                  </div>
                  <div className={styles.integrationFieldGroup}>
                    <label className={styles.integrationFieldLabel} htmlFor={`integration-model-${integration.integration_id}`}>Default Model</label>
                    <Input
                      id={`integration-model-${integration.integration_id}`}
                      aria-label={`Default model for ${integration.name}`}
                      value={draft.defaultModel}
                      onChange={(e) => setDrafts((prev) => ({
                        ...prev,
                        [integration.integration_id]: { ...draft, defaultModel: e.target.value },
                      }))}
                      placeholder="Optional model override…"
                    />
                  </div>
                  <div className={`${styles.integrationFieldGroup} ${styles.integrationFieldGroupFull}`}>
                    <label className={styles.integrationFieldLabel} htmlFor={`integration-key-${integration.integration_id}`}>API Key</label>
                    <Input
                      id={`integration-key-${integration.integration_id}`}
                      aria-label={`API key for ${integration.name}`}
                      type="password"
                      value={draft.apiKey}
                      onChange={(e) => setDrafts((prev) => ({
                        ...prev,
                        [integration.integration_id]: { ...draft, apiKey: e.target.value },
                      }))}
                      placeholder={integration.has_secret ? "Leave blank to keep the existing key…" : "Paste the provider key…"}
                    />
                  </div>
                  <div className={styles.integrationActions}>
                    <Button variant="ghost" onClick={() => onDelete(integration.integration_id)} disabled={isBusy}>
                      Delete
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => onUpdate(integration.integration_id, {
                        name: draft.name.trim(),
                        provider: draft.provider,
                        default_model: draft.defaultModel.trim() || null,
                        api_key: draft.apiKey.trim() || null,
                      })}
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
        Secrets are stored at the organization layer and only attached to agents through integration bindings.
      </Text>
    </div>
  );
}

function ProviderButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.providerButtonRow}>
      {PROVIDERS.map((provider) => (
        <Button
          key={provider.id}
          variant={value === provider.id ? "primary" : "ghost"}
          onClick={() => onChange(provider.id)}
        >
          {provider.label}
        </Button>
      ))}
    </div>
  );
}
