import { BRAND_ICONS } from "./profile-card-texture";
import styles from "./AgentInfoPanel.module.css";

export interface ProfileChannelBarProps {
  /** Triggered by the Telegram (first) icon; wired to the connect flow. */
  onTelegramClick: () => void;
  /** Disables the Telegram icon while a link is being generated. */
  telegramDisabled?: boolean;
  /** Tints the Telegram icon green once the channel is connected. */
  telegramConnected?: boolean;
}

/**
 * The messaging-channel logo bar that used to live inside the spec card, now a
 * standalone pill sitting above it. The Telegram (first) icon is interactive
 * and shares the same connect flow as the Telegram panel's Connect button; the
 * remaining logos stay decorative.
 */
export function ProfileChannelBar({
  onTelegramClick,
  telegramDisabled = false,
  telegramConnected = false,
}: ProfileChannelBarProps) {
  return (
    <div className={styles.channelBar}>
      <div className={styles.specChannels} aria-label="Messaging channels">
        {BRAND_ICONS.map((icon) => {
          const isTelegram = icon.name === "Telegram";
          const iconClass =
            isTelegram && telegramConnected
              ? `${styles.specChannelIcon} ${styles.specChannelIconConnected}`
              : styles.specChannelIcon;
          const glyph = (
            <svg
              className={iconClass}
              viewBox={`0 0 ${icon.size ?? 24} ${icon.size ?? 24}`}
              role="img"
              aria-label={icon.name}
            >
              <path d={icon.path} fill="currentColor" />
            </svg>
          );

          if (isTelegram) {
            return (
              <button
                key={icon.name}
                type="button"
                className={styles.specChannelButton}
                onClick={onTelegramClick}
                disabled={telegramDisabled}
                aria-label={telegramConnected ? "Telegram connected" : "Connect Telegram"}
                title={telegramConnected ? "Telegram connected" : "Connect Telegram"}
              >
                {glyph}
              </button>
            );
          }

          return <span key={icon.name}>{glyph}</span>;
        })}
      </div>
    </div>
  );
}
