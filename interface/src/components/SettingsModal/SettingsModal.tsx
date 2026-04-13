import { Modal, Heading, Button, Spinner, Text } from "@cypher-asi/zui";
import { CircleHelp, LogOut, Shield } from "lucide-react";
import { useAuth } from "../../stores/auth-store";
import { Select } from "../Select";
import { useSettingsData } from "./useSettingsData";
import styles from "./SettingsModal.module.css";

const CHANNEL_OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "nightly", label: "Nightly" },
];

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  const {
    loading,
    updateChannel,
    currentVersion,
    showUpdater,
    privacyPolicyUrl,
    supportUrl,
    handleChannelChange,
  } =
    useSettingsData(isOpen);

  const openExternal = (url: string | null) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const hasExternalSupport = Boolean(privacyPolicyUrl || supportUrl);

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
                  <Select
                    className={styles.channelSelect}
                    value={updateChannel}
                    onChange={(v) => handleChannelChange(v as "stable" | "nightly")}
                    options={CHANNEL_OPTIONS}
                  />
                </div>

                <Text variant="muted" size="sm">
                  {updateChannel === "nightly"
                    ? "You'll receive builds from every push to main."
                    : "You'll only receive tagged releases."}
                </Text>
              </>
            )}

            {hasExternalSupport && (
              <>
                <div className={styles.divider} />

                <Heading level={4}>Support & Privacy</Heading>

                <Text variant="muted" size="sm">
                  Helpful links for app support, store review, and policy disclosures.
                </Text>

                <div className={styles.linkActions}>
                  {privacyPolicyUrl && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Shield size={14} />}
                      onClick={() => openExternal(privacyPolicyUrl)}
                    >
                      Privacy Policy
                    </Button>
                  )}
                  {supportUrl && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<CircleHelp size={14} />}
                      onClick={() => openExternal(supportUrl)}
                    >
                      Support
                    </Button>
                  )}
                </div>
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
