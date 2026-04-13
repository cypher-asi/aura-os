import { Button, Spinner, Text } from "@cypher-asi/zui";
import { Download, X } from "lucide-react";
import { useUpdateBanner } from "./useUpdateBanner";
import styles from "./UpdateBanner.module.css";

export function UpdateBanner() {
  const {
    data,
    enabled,
    installPending,
    dismissAvailableUpdate,
    handleInstallUpdate,
  } = useUpdateBanner();

  if (!enabled || !data) return null;

  const { update } = data;

  if (update.status === "available") {
    return (
      <div className={styles.banner} data-variant="ready">
        <Download size={14} className={styles.icon} />
        <Text size="sm">
          Aura v{update.version} is ready. Install when you’re ready to restart.
        </Text>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleInstallUpdate()}
            disabled={installPending}
            icon={installPending ? <Spinner size="sm" /> : <Download size={14} />}
          >
            {installPending ? "Preparing…" : "Install update"}
          </Button>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss update notice"
            onClick={dismissAvailableUpdate}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (update.status === "downloading") {
    return (
      <div className={styles.banner} data-variant="info">
        <Download size={14} className={styles.icon} />
        <Text size="sm">Downloading Aura v{update.version}&hellip;</Text>
      </div>
    );
  }

  if (update.status === "installing") {
    return (
      <div className={styles.banner} data-variant="ready">
        <Download size={14} className={styles.icon} />
        <Text size="sm">
          Installing Aura v{update.version} and restarting&hellip;
        </Text>
      </div>
    );
  }

  if (update.status === "failed") {
    return (
      <div className={styles.banner} data-variant="info">
        <Download size={14} className={styles.icon} />
        <Text size="sm">Update failed: {update.error || "unknown error"}</Text>
      </div>
    );
  }

  return null;
}
