import { Modal, Heading, Button, Spinner, Text } from "@cypher-asi/zui";
import { LogOut } from "lucide-react";
import { useAuth } from "../../stores/auth-store";
import { useSettingsData } from "./useSettingsData";
import styles from "./SettingsModal.module.css";

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  const { loading, updateChannel, currentVersion, showUpdater, handleChannelChange } =
    useSettingsData(isOpen);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="sm">
      <div className={styles.content}>
        {loading ? (
          <Spinner />
        ) : (
          <>
            {showUpdater && (
              <>
                <div className={styles.divider} />

                <Heading level={4}>Updates</Heading>

                <div className={styles.infoGrid}>
                  <Text variant="muted" size="sm" as="span">Version</Text>
                  <Text size="sm" as="span" className={styles.monoText}>
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
