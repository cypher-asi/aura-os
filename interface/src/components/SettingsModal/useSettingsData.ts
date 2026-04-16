import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import type { DesktopUpdateState } from "../../api/desktop";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getPrivacyPolicyUrl, getSupportUrl } from "../../lib/app-links";

interface SettingsData {
  loading: boolean;
  updateChannel: "stable" | "nightly";
  currentVersion: string;
  updateState: DesktopUpdateState | null;
  installPending: boolean;
  showUpdater: boolean;
  privacyPolicyUrl: string | null;
  supportUrl: string | null;
  handleCheckForUpdates: () => Promise<void>;
  handleChannelChange: (ch: "stable" | "nightly") => Promise<void>;
  handleInstallUpdate: () => Promise<void>;
}

export function useSettingsData(isOpen: boolean): SettingsData {
  const { features } = useAuraCapabilities();
  const [loading, setLoading] = useState(true);
  const [updateChannel, setUpdateChannel] = useState<"stable" | "nightly">("stable");
  const [currentVersion, setCurrentVersion] = useState("");
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [installPending, setInstallPending] = useState(false);
  const [showUpdater, setShowUpdater] = useState(false);

  const refreshUpdateStatus = useCallback(async () => {
    const status = await api.getUpdateStatus();
    setUpdateChannel(status.channel);
    setCurrentVersion(status.current_version);
    setUpdateState(status.update);
    setShowUpdater(status.supported !== false);
    if (status.update.status !== "available") {
      setInstallPending(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => setLoading(true));
    const requests: Promise<unknown>[] = [];
    if (features.nativeUpdater) {
      requests.push(refreshUpdateStatus());
    } else {
      window.requestAnimationFrame(() => {
        setCurrentVersion("");
        setUpdateState(null);
        setShowUpdater(false);
      });
    }
    Promise.all(requests)
      .catch(console.error)
      .finally(() => setLoading(false));
    return () => window.cancelAnimationFrame(frame);
  }, [features.nativeUpdater, isOpen, refreshUpdateStatus]);

  const handleChannelChange = useCallback(
    async (ch: "stable" | "nightly") => {
      const previousChannel = updateChannel;
      setUpdateChannel(ch);
      try {
        const response = await api.setUpdateChannel(ch);
        if (!response.ok) {
          throw new Error(response.error || "failed to switch update channel");
        }
        await refreshUpdateStatus();
      } catch (error) {
        console.error(error);
        setUpdateChannel(previousChannel);
      }
    },
    [refreshUpdateStatus, updateChannel],
  );

  const handleInstallUpdate = useCallback(async () => {
    setInstallPending(true);
    try {
      const response = await api.installUpdate();
      if (!response.ok) {
        throw new Error(response.error || "failed to start update install");
      }
      await refreshUpdateStatus();
    } catch (error) {
      console.error(error);
      setInstallPending(false);
    }
  }, [refreshUpdateStatus]);

  const handleCheckForUpdates = useCallback(async () => {
    try {
      const response = await api.checkForUpdates();
      if (!response.ok) {
        throw new Error(response.error || "failed to trigger update check");
      }
      await refreshUpdateStatus();
      window.setTimeout(() => {
        void refreshUpdateStatus().catch(console.error);
      }, 1500);
    } catch (error) {
      console.error(error);
    }
  }, [refreshUpdateStatus]);

  return {
    loading,
    updateChannel,
    currentVersion,
    updateState,
    installPending,
    showUpdater: !!features.nativeUpdater && showUpdater,
    privacyPolicyUrl: getPrivacyPolicyUrl(),
    supportUrl: getSupportUrl(),
    handleCheckForUpdates,
    handleChannelChange,
    handleInstallUpdate,
  };
}
