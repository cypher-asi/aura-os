import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getPrivacyPolicyUrl, getSupportUrl } from "../../lib/app-links";

interface SettingsData {
  loading: boolean;
  updateChannel: "stable" | "nightly";
  currentVersion: string;
  showUpdater: boolean;
  privacyPolicyUrl: string | null;
  supportUrl: string | null;
  handleChannelChange: (ch: "stable" | "nightly") => Promise<void>;
}

export function useSettingsData(isOpen: boolean): SettingsData {
  const { features } = useAuraCapabilities();
  const [loading, setLoading] = useState(true);
  const [updateChannel, setUpdateChannel] = useState<"stable" | "nightly">("stable");
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => setLoading(true));
    const requests: Promise<unknown>[] = [];
    if (features.nativeUpdater) {
      requests.push(
        api.getUpdateStatus().then((s) => {
          setUpdateChannel(s.channel as "stable" | "nightly");
          setCurrentVersion(s.current_version);
        }),
      );
    } else {
      window.requestAnimationFrame(() => setCurrentVersion(""));
    }
    Promise.all(requests)
      .catch(console.error)
      .finally(() => setLoading(false));
    return () => window.cancelAnimationFrame(frame);
  }, [features.nativeUpdater, isOpen]);

  const handleChannelChange = useCallback(
    async (ch: "stable" | "nightly") => {
      setUpdateChannel(ch);
      try { await api.setUpdateChannel(ch); } catch { setUpdateChannel(updateChannel); }
    },
    [updateChannel],
  );

  return {
    loading, updateChannel, currentVersion,
    showUpdater: !!features.nativeUpdater,
    privacyPolicyUrl: getPrivacyPolicyUrl(),
    supportUrl: getSupportUrl(),
    handleChannelChange,
  };
}
