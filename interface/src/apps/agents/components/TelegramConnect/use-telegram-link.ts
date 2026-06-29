import { useCallback, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import { ApiClientError } from "../../../../shared/api/core";
import { getApiErrorMessage } from "../../../../shared/utils/api-errors";
import type {
  ChannelSummary,
  TelegramLinkResult,
} from "../../../../shared/api/channels";
import type { Agent } from "../../../../shared/types";
import { telegramChannelsQueryKey } from "./query-key";

const POLL_INTERVAL_MS = 3_000;
/** Slow cadence used when the endpoint is erroring (e.g. server not yet
 * rebuilt with the channels routes) so a missing/unreachable endpoint never
 * turns into a 3s retry storm that re-renders the whole sidekick. */
const ERROR_BACKOFF_MS = 15_000;

export interface UseTelegramLinkArgs {
  agent: Agent;
  /**
   * When provided, the PARENT owns the channels query and this hook does not
   * start its own polling observer. This prevents the same `["channels",
   * agentId]` key from being polled by two observers at once.
   */
  channels?: ChannelSummary[];
  /** Ask the query owner to refetch (used when this hook is parent-managed). */
  onChanged?: () => void;
}

/**
 * Telegram link state and actions, shared by the messaging-channel icon bar and
 * the `TelegramConnect` panel so both drive (and reflect) the same connect flow.
 */
export interface TelegramLinkController {
  isRemote: boolean;
  link: TelegramLinkResult | null;
  linking: boolean;
  linkError: string | null;
  disconnecting: boolean;
  telegramChannel: ChannelSummary | null;
  isConnected: boolean;
  needsRelink: boolean;
  startLink: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useTelegramLink({
  agent,
  channels: externalChannels,
  onChanged,
}: UseTelegramLinkArgs): TelegramLinkController {
  const isRemote = agent.machine_type === "remote";
  const agentId = agent.agent_id;
  // When the parent injects `channels`, it owns the polling; we stay passive.
  const parentManaged = externalChannels !== undefined;

  const [link, setLink] = useState<TelegramLinkResult | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const internalQuery = useQuery({
    queryKey: telegramChannelsQueryKey(agentId),
    queryFn: () => api.channels.listChannels(agentId),
    enabled: isRemote && !parentManaged,
    // Keep the last good data on the screen across refetches so rows never
    // flicker to an empty/loading state mid-poll (a source of layout jank).
    placeholderData: keepPreviousData,
    // A failing poll should not fan out into retries; the interval already
    // re-attempts on its own cadence.
    retry: false,
    // Opening the Telegram deep link steals focus; don't let regaining it
    // trigger an extra refetch + re-render.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") return ERROR_BACKOFF_MS;
      const channels = query.state.data?.channels ?? [];
      const hasConnected = channels.some(
        (c) => c.kind === "telegram" && c.status === "connected",
      );
      return hasConnected ? false : POLL_INTERVAL_MS;
    },
  });

  const channels = externalChannels ?? internalQuery.data?.channels;

  const telegramChannel = useMemo<ChannelSummary | null>(
    () => (channels ?? []).find((c) => c.kind === "telegram") ?? null,
    [channels],
  );

  const isConnected = telegramChannel?.status === "connected";
  const needsRelink = telegramChannel?.status === "needs_relink";

  const refreshChannels = useCallback(async () => {
    if (parentManaged) {
      onChanged?.();
    } else {
      await internalQuery.refetch();
    }
  }, [parentManaged, onChanged, internalQuery]);

  const startLink = useCallback(async () => {
    setLinking(true);
    setLinkError(null);
    try {
      const res = await api.channels.linkTelegram(agentId);
      setLink(res);
      // Best-effort: pop Telegram on the same device. Never let a blocked
      // popup throw into the connect flow.
      try {
        window.open(res.deep_link, "_blank", "noopener,noreferrer");
      } catch {
        /* popup blocked — the QR below still works */
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 503) {
        setLinkError(
          "Telegram bot isn't configured on this server yet. Ask an admin to set it up.",
        );
      } else {
        setLinkError(getApiErrorMessage(err));
      }
    } finally {
      setLinking(false);
    }
  }, [agentId]);

  const disconnect = useCallback(async () => {
    if (!telegramChannel) return;
    setDisconnecting(true);
    try {
      await api.channels.disconnectChannel(agentId, telegramChannel.channel_id);
      setLink(null);
      await refreshChannels();
    } catch (err) {
      setLinkError(getApiErrorMessage(err));
    } finally {
      setDisconnecting(false);
    }
  }, [agentId, refreshChannels, telegramChannel]);

  return {
    isRemote,
    link,
    linking,
    linkError,
    disconnecting,
    telegramChannel,
    isConnected,
    needsRelink,
    startLink,
    disconnect,
  };
}
