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

      <div className={styles.settingsGroup}>
        <div className={styles.settingsGroupLabel}>Create Integration</div>
        <div className={styles.formRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Connection details</div>
            <div className={styles.rowDescription}>
              Store reusable provider credentials once at the organization level, then attach them only where API-backed runtime auth is needed.
            </div>
          </div>
          <div className={styles.rowControl} style={{ flexDirection: "column", alignItems: "stretch", width: "360px", maxWidth: "100%" }}>
            <Input
              value={newIntegration.name}
              onChange={(e) => setNewIntegration((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Anthropic Prod"
            />
            <ProviderButtons
              value={newIntegration.provider}
              onChange={(provider) => setNewIntegration((prev) => ({ ...prev, provider }))}
            />
            <Input
              value={newIntegration.defaultModel}
              onChange={(e) => setNewIntegration((prev) => ({ ...prev, defaultModel: e.target.value }))}
              placeholder="Default model (optional)"
            />
            <Input
              type="password"
              value={newIntegration.apiKey}
              onChange={(e) => setNewIntegration((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="API key"
            />
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

      <div className={styles.settingsGroup}>
        <div className={styles.settingsGroupLabel}>Saved Integrations</div>
        {integrations.length === 0 ? (
          <div className={styles.emptyMessage}>No integrations yet.</div>
        ) : (
          integrations.map((integration) => {
            const draft = mergedDrafts[integration.integration_id];
            const isBusy = busyId === integration.integration_id;
            return (
              <div key={integration.integration_id} className={styles.formRow}>
                <div className={styles.rowInfo}>
                  <div className={styles.rowLabel}>{integration.name}</div>
                  <div className={styles.rowDescription}>
                    {integration.provider}
                    {integration.secret_last4 ? ` • key ending in ${integration.secret_last4}` : " • no key saved"}
                  </div>
                </div>
                <div className={styles.rowControl} style={{ flexDirection: "column", alignItems: "stretch", width: "360px", maxWidth: "100%" }}>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDrafts((prev) => ({
                      ...prev,
                      [integration.integration_id]: { ...draft, name: e.target.value },
                    }))}
                    placeholder="Name"
                  />
                  <ProviderButtons
                    value={draft.provider}
                    onChange={(provider) => setDrafts((prev) => ({
                      ...prev,
                      [integration.integration_id]: { ...draft, provider },
                    }))}
                  />
                  <Input
                    value={draft.defaultModel}
                    onChange={(e) => setDrafts((prev) => ({
                      ...prev,
                      [integration.integration_id]: { ...draft, defaultModel: e.target.value },
                    }))}
                    placeholder="Default model (optional)"
                  />
                  <Input
                    type="password"
                    value={draft.apiKey}
                    onChange={(e) => setDrafts((prev) => ({
                      ...prev,
                      [integration.integration_id]: { ...draft, apiKey: e.target.value },
                    }))}
                    placeholder={integration.has_secret ? "Leave blank to keep existing key" : "API key"}
                  />
                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
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
    <div style={{ display: "flex", gap: "8px" }}>
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
