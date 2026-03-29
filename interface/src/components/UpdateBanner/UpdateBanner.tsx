import { Button, Text } from "@cypher-asi/zui";
import { Download, X } from "lucide-react";
import { useUpdateBanner } from "./useUpdateBanner";
import styles from "./UpdateBanner.module.css";

export function UpdateBanner() {
  const { data, dismissed, installing, enabled, dismiss, install } = useUpdateBanner();

  if (!enabled || !data || dismissed) return null;

  const { update } = data;

  if (update.status === "downloading") {
    return (
      <div className={styles.banner} data-variant="info">
        <Download size={14} className={styles.icon} />
        <Text size="sm">Downloading update&hellip;</Text>
      </div>
    );
  }

  if (update.status === "ready") {
    return (
      <div className={styles.banner} data-variant="ready">
        <Download size={14} className={styles.icon} />
        <Text size="sm">
          Aura v{update.version} is ready to install.
        </Text>
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="sm"
            disabled={installing}
            onClick={install}
          >
            {installing ? "Installing…" : "Restart & Update"}
          </Button>
          <button
            className={styles.dismiss}
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
