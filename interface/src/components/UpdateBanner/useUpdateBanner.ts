import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import type { DesktopUpdateStatusResponse } from "../../api/desktop";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";

interface UpdateBannerData {
  data: DesktopUpdateStatusResponse | null;
  enabled: boolean;
  installPending: boolean;
  dismissAvailableUpdate: () => void;
  handleInstallUpdate: () => Promise<void>;
}

const POLL_INTERVAL = 5_000;

export function useUpdateBanner(): UpdateBannerData {
  const { features } = useAuraCapabilities();
  const [data, setData] = useState<DesktopUpdateStatusResponse | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [installPending, setInstallPending] = useState(false);
  const enabled = !!features.nativeUpdater && data?.supported !== false;

  const poll = useCallback(() => {
    api.getUpdateStatus().then((next) => {
      setData(next);
      if (next.update.status !== "available") {
        setInstallPending(false);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!features.nativeUpdater) return;
    poll();
  }, [features.nativeUpdater, poll]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [enabled, poll]);

  useEffect(() => {
    if (data?.update.status !== "available" || data.update.version !== dismissedVersion) {
      setDismissedVersion((current) => {
        if (
          data?.update.status === "available" &&
          data.update.version &&
          data.update.version === current
        ) {
          return current;
        }
        return null;
      });
    }
  }, [data, dismissedVersion]);

  const dismissAvailableUpdate = useCallback(() => {
    if (data?.update.status === "available" && data.update.version) {
      setDismissedVersion(data.update.version);
    }
  }, [data]);

  const handleInstallUpdate = useCallback(async () => {
    setInstallPending(true);
    try {
      await api.installUpdate();
      await poll();
    } catch (error) {
      console.error(error);
      setInstallPending(false);
    }
  }, [poll]);

  const visibleData =
    data?.update.status === "available" && data.update.version === dismissedVersion ? null : data;

  return {
    data: visibleData,
    enabled,
    installPending,
    dismissAvailableUpdate,
    handleInstallUpdate,
  };
}
