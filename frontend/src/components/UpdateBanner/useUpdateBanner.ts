import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";

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

interface UpdateBannerData {
  data: UpdateStatusResponse | null;
  dismissed: boolean;
  installing: boolean;
  enabled: boolean;
  dismiss: () => void;
  install: () => Promise<void>;
}

const POLL_INTERVAL = 60_000;

export function useUpdateBanner(): UpdateBannerData {
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

  const dismiss = useCallback(() => setDismissed(true), []);

  const install = useCallback(async () => {
    setInstalling(true);
    try { await api.installUpdate(); } catch { setInstalling(false); }
  }, []);

  return { data, dismissed, installing, enabled: !!features.nativeUpdater, dismiss, install };
}
