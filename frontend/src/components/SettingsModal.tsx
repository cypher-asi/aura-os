import { useEffect, useState, useCallback } from "react";
import { Modal, Heading, Button, Spinner, Text } from "@cypher-asi/zui";
import { LogOut } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
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
  const { features } = useAuraCapabilities();
  const [info, setInfo] = useState<ApiKeyInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [updateChannel, setUpdateChannel] = useState<"stable" | "nightly">("stable");
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const requests = [api.getApiKeyInfo().then(setInfo)];
    if (features.nativeUpdater) {
      requests.push(
        api.getUpdateStatus().then((s) => {
          setUpdateChannel(s.channel as "stable" | "nightly");
          setCurrentVersion(s.current_version);
        }),
      );
    } else {
      setCurrentVersion("");
    }
    Promise.all(requests)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [features.nativeUpdater, isOpen]);

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="sm">
      <div className={styles.content}>
        {loading ? (
          <Spinner />
        ) : (
          <>
            <Heading level={4}>Claude API Key</Heading>

            <div className={styles.infoGrid}>
              <Text variant="muted" size="sm" as="span">Status</Text>
              <Text size="sm" as="span" style={{ fontFamily: "var(--font-mono)" }}>
                {info?.configured ? "Configured" : "Not configured"}
              </Text>
            </div>

            {!info?.configured && (
              <Text variant="muted" size="sm">
                Set <code>ANTHROPIC_API_KEY</code> in your <code>.env</code> file and restart the server.
              </Text>
            )}

            {features.nativeUpdater && (
              <>
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
              </>
            )}

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
