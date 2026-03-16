import { useEffect, useState, useCallback } from "react";
import { Modal, Heading, Label, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { LogOut } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "./StatusBadge";
import type { ApiKeyInfo } from "../types";
import styles from "./SettingsModal.module.css";

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  const [info, setInfo] = useState<ApiKeyInfo | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [updateChannel, setUpdateChannel] = useState<"stable" | "nightly">("stable");
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([
      api.getApiKeyInfo().then(setInfo),
      api.getUpdateStatus().then((s) => {
        setUpdateChannel(s.channel as "stable" | "nightly");
        setCurrentVersion(s.current_version);
      }),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleChannelChange = useCallback(
    async (ch: "stable" | "nightly") => {
      setUpdateChannel(ch);
      try {
        await api.setUpdateChannel(ch);
      } catch {
        setUpdateChannel(updateChannel);
      }
    },
    [updateChannel],
  );

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
      setInfo({
        status: "not_set",
        masked_key: null,
        last_validated_at: null,
        updated_at: null,
      });
      setMessage("API key deleted");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="sm">
      <div className={styles.content}>
        {loading ? (
          <Spinner />
        ) : (
          <>
            <Heading level={4}>Claude API Key</Heading>

            {info && info.status !== "not_set" && (
              <div className={styles.infoGrid}>
                <Text variant="muted" size="sm" as="span">Status</Text>
                <span><StatusBadge status={info.status} /></span>
                <Text variant="muted" size="sm" as="span">Masked Key</Text>
                <Text size="sm" as="span" style={{ fontFamily: "var(--font-mono)" }}>
                  {info.masked_key || "—"}
                </Text>
                {info.updated_at && (
                  <>
                    <Text variant="muted" size="sm" as="span">Updated</Text>
                    <Text size="sm" as="span">
                      {new Date(info.updated_at).toLocaleString()}
                    </Text>
                  </>
                )}
              </div>
            )}

            <div>
              <Label
                size="sm"
                uppercase={false}
                style={{ display: "block", marginBottom: "var(--space-1)" }}
              >
                {info?.status === "not_set" ? "Enter API Key" : "Update API Key"}
              </Label>
              <Input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                mono
              />
            </div>

            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={saving || !keyInput.trim()}
              >
                {saving ? <><Spinner size="sm" /> Saving...</> : "Save"}
              </Button>
              {info && info.status !== "not_set" && (
                <Button variant="danger" size="sm" onClick={handleDelete}>
                  Delete Key
                </Button>
              )}
            </div>

            {message && (
              <Text variant="secondary" size="sm">{message}</Text>
            )}

            <div className={styles.divider} />

            <Heading level={4}>Updates</Heading>

            <div className={styles.infoGrid}>
              <Text variant="muted" size="sm" as="span">Version</Text>
              <Text size="sm" as="span" style={{ fontFamily: "var(--font-mono)" }}>
                {currentVersion || "—"}
              </Text>
              <Text variant="muted" size="sm" as="span">Channel</Text>
              <select
                className={styles.channelSelect}
                value={updateChannel}
                onChange={(e) => handleChannelChange(e.target.value as "stable" | "nightly")}
              >
                <option value="stable">Stable</option>
                <option value="nightly">Nightly</option>
              </select>
            </div>

            <Text variant="muted" size="sm">
              {updateChannel === "nightly"
                ? "You'll receive builds from every push to main."
                : "You'll only receive tagged releases."}
            </Text>

            <div className={styles.divider} />

            <div className={styles.logoutSection}>
              <Text variant="muted" size="sm">Sign out of your account</Text>
              <Button
                variant="danger"
                size="sm"
                icon={<LogOut size={14} />}
                onClick={logout}
              >
                Logout
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
