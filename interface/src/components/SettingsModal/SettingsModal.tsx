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
    updateState,
    installPending,
    showUpdater,
    privacyPolicyUrl,
    supportUrl,
    handleChannelChange,
    handleInstallUpdate,
  } =
    useSettingsData(isOpen);

  const openExternal = (url: string | null) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const hasExternalSupport = Boolean(privacyPolicyUrl || supportUrl);

  const updateSummary = (() => {
    if (!updateState) return null;
    switch (updateState.status) {
      case "available":
        return `Aura v${updateState.version} is ready to install when you want to restart.`;
      case "checking":
        return "Checking for updates.";
      case "downloading":
        return `Downloading Aura v${updateState.version}.`;
      case "installing":
        return `Installing Aura v${updateState.version} and restarting.`;
      case "failed":
        return updateState.error || "Update failed.";
      case "up_to_date":
        return "You're on the latest available build for this channel.";
      default:
        return "Aura will check quietly in the background and only install when you approve it.";
    }
  })();

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

                {updateSummary && (
                  <Text
                    variant="muted"
                    size="sm"
                    className={updateState?.status === "failed" ? styles.dangerText : undefined}
                  >
                    {updateSummary}
                  </Text>
                )}

                <div className={styles.updateActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleInstallUpdate()}
                    disabled={updateState?.status !== "available" || installPending}
                  >
                    {installPending ? "Preparing update…" : "Install update"}
                  </Button>
                </div>

                <Text variant="muted" size="sm">
                  {updateChannel === "nightly"
                    ? "You'll receive builds from every push to main."
                    : "You'll only receive tagged releases."} Updates are offered in-app and only install when you choose.
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
