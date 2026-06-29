import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Text, Button } from "@cypher-asi/zui";
import { Send, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { ChannelSummary } from "../../../../shared/api/channels";
import type { Agent } from "../../../../shared/types";
import {
  useTelegramLink,
  type TelegramLinkController,
} from "./use-telegram-link";
import styles from "./TelegramConnect.module.css";

export interface TelegramConnectProps {
  agent: Agent;
  /** Tightens spacing for placement under the profile card. */
  compact?: boolean;
  /**
   * When provided, the PARENT owns the channels query and this component does
   * not start its own polling observer. This prevents the same `["channels",
   * agentId]` key from being polled by two observers at once (MessagingTab +
   * this component), which caused redundant refetches and re-render jank.
   */
  channels?: ChannelSummary[];
  /** Ask the query owner to refetch (used when this component is parent-managed). */
  onChanged?: () => void;
  /**
   * Share an existing link controller (e.g. from the profile icon bar) so the
   * Connect button and the Telegram icon drive the same flow and the QR shows
   * regardless of which one is clicked. When omitted, the component owns its own.
   */
  controller?: TelegramLinkController;
}

export function TelegramConnect({
  agent,
  compact = false,
  channels: externalChannels,
  onChanged,
  controller: externalController,
}: TelegramConnectProps) {
  // Always call the hook (rules of hooks); when a controller is injected we use
  // it instead, so the internal one stays passive (no extra polling observer
  // since the injected controller already owns the query).
  const internalController = useTelegramLink({
    agent,
    channels: externalChannels,
    onChanged,
  });
  const controller = externalController ?? internalController;

  return <TelegramConnectView controller={controller} compact={compact} />;
}

/**
 * Presentational Telegram panel. Renders the three connect states off a shared
 * {@link TelegramLinkController} so it can be driven by either its own hook or a
 * controller lifted into a parent (see the profile messaging-channel icon bar).
 * When `onClose` is provided it renders a dismiss (X) button, so it can be used
 * as a pop-over below the icon bar.
 */
export function TelegramConnectView({
  controller,
  compact = false,
  onClose,
}: {
  controller: TelegramLinkController;
  compact?: boolean;
  /** When set, renders an X dismiss button in the panel's top-right corner. */
  onClose?: () => void;
}) {
  const {
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
  } = controller;

  const rootClass = compact
    ? `${styles.root} ${styles.compact}`
    : styles.root;

  let state: "disabled" | "connected" | "connect";
  let content: ReactNode;

  if (!isRemote) {
    state = "disabled";
    content = (
      <div className={styles.header}>
        <Send size={16} className={styles.brandIcon} />
        <Text size="sm" weight="medium">Telegram</Text>
      </div>
    );
    content = (
      <>
        {content}
        <Text size="xs" variant="muted">Available for remote agents only</Text>
      </>
    );
  } else if (isConnected && telegramChannel) {
    state = "connected";
    content = (
      <>
        <div className={styles.header}>
          <Send size={16} className={styles.brandIcon} />
          <Text size="sm" weight="medium">Telegram</Text>
          <span className={styles.connectedPill}>
            <CheckCircle2 size={12} />
            Connected
          </span>
        </div>
        <Text size="xs" variant="muted" className={styles.chatId}>
          Chat {telegramChannel.chat_id}
        </Text>
        {linkError && (
          <Text size="xs" className={styles.errorText}>{linkError}</Text>
        )}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={disconnect}
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      </>
    );
  } else {
    state = "connect";
    content = (
      <>
        <div className={styles.connectRow}>
          <div className={styles.header}>
            <Send size={16} className={styles.brandIcon} />
            <Text size="sm" weight="medium">Telegram</Text>
            {needsRelink && (
              <span className={styles.relinkPill}>
                <AlertTriangle size={12} />
                Needs reconnect
              </span>
            )}
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={startLink}
            disabled={linking}
            className={styles.connectButton}
          >
            {linking ? (
              <span className={styles.btnInner}>
                <Loader2 size={14} className={styles.spin} />
                Generating link…
              </span>
            ) : needsRelink ? (
              "Reconnect"
            ) : (
              "Connect"
            )}
          </Button>
        </div>

        {needsRelink && (
          <Text size="xs" variant="muted">
            This connection expired. Reconnect to keep messaging this agent.
          </Text>
        )}

        {linkError && (
          <Text size="xs" className={styles.errorText}>{linkError}</Text>
        )}

        {link && (
          <div className={styles.qrBlock}>
            <div className={styles.qrFrame}>
              <QRCodeSVG value={link.deep_link} size={compact ? 120 : 148} />
            </div>
            <Text size="xs" variant="muted" className={styles.qrCaption}>
              Scan to connect from your phone
            </Text>
            <span className={styles.waiting}>
              <Loader2 size={12} className={styles.spin} />
              Waiting for confirmation…
            </span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={rootClass} data-telegram-connect={state}>
      {onClose && (
        <div className={styles.closeRow}>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {content}
    </div>
  );
}
