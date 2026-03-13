import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ApiKeyInfo } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { Page, Panel, Heading, Label, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import styles from "./aura.module.css";

export function SettingsView() {
  const [info, setInfo] = useState<ApiKeyInfo | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api
      .getApiKeyInfo()
      .then(setInfo)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.setApiKey(keyInput.trim());
      setInfo(updated);
      setKeyInput("");
      setMessage("API key saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteApiKey();
      setInfo({ status: "not_set", masked_key: null, last_validated_at: null, updated_at: null });
      setMessage("API key deleted");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (loading) return <Spinner />;

  return (
    <Page title="Settings" subtitle="Manage your API key">
      <Panel variant="solid" border="solid" borderRadius="md" style={{ maxWidth: 560, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <Heading level={4}>Claude API Key</Heading>

        {info && info.status !== "not_set" && (
          <div className={styles.infoGrid} style={{ marginBottom: "var(--space-2)" }}>
            <Text variant="muted" size="sm" as="span">Status</Text>
            <span><StatusBadge status={info.status} /></span>
            <Text variant="muted" size="sm" as="span">Masked Key</Text>
            <Text size="sm" as="span" style={{ fontFamily: "var(--font-mono)" }}>{info.masked_key || "—"}</Text>
            {info.updated_at && (
              <>
                <Text variant="muted" size="sm" as="span">Updated</Text>
                <Text size="sm" as="span">{new Date(info.updated_at).toLocaleString()}</Text>
              </>
            )}
          </div>
        )}

        <div>
          <Label size="sm" uppercase={false} style={{ display: "block", marginBottom: "var(--space-1)" }}>
            {info?.status === "not_set" ? "Enter API Key" : "Update API Key"}
          </Label>
          <Input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-ant-..." mono />
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !keyInput.trim()}>
            {saving ? <><Spinner size="sm" /> Saving...</> : "Save"}
          </Button>
          {info && info.status !== "not_set" && (
            <Button variant="danger" size="sm" onClick={handleDelete}>Delete Key</Button>
          )}
        </div>

        {message && <Text variant="secondary" size="sm">{message}</Text>}
      </Panel>
    </Page>
  );
}
