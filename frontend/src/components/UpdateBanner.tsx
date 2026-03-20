import { useEffect, useState, useCallback } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { Download, X } from "lucide-react";
import { api } from "../api/client";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import styles from "./UpdateBanner.module.css";

interface UpdateStatusResponse {
  update: {
    status: string;
    version?: string;
    channel?: string;
    error?: string;
  };
  channel: string;
  current_version: string;
}

const POLL_INTERVAL = 60_000;

export function UpdateBanner() {
  const { features } = useAuraCapabilities();
  const [data, setData] = useState<UpdateStatusResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const poll = useCallback(() => {
    api.getUpdateStatus().then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    if (!features.nativeUpdater) return;
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [features.nativeUpdater, poll]);

  if (!features.nativeUpdater) return null;

  if (!data || dismissed) return null;

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
            onClick={async () => {
              setInstalling(true);
              try {
                await api.installUpdate();
              } catch {
                setInstalling(false);
              }
            }}
          >
            {installing ? "Installing…" : "Restart & Update"}
          </Button>
          <button
            className={styles.dismiss}
            onClick={() => setDismissed(true)}
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
