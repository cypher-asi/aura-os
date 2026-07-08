import { Panel, Text } from "@cypher-asi/zui";
import {
  NOTIFICATION_KIND_LABELS,
  NotificationKind,
} from "../../../shared/types/notifications";
import { useNotificationPreferencesStore } from "../../../stores/notification-preferences-store";
import styles from "./NotificationsSection.module.css";

export function NotificationsSection() {
  const preferences = useNotificationPreferencesStore((state) => state.preferences);
  const {
    setEnabled,
    setDesktopEnabled,
    setInAppEnabled,
    setSoundEnabled,
    setCondition,
    setTypeEnabled,
  } = useNotificationPreferencesStore();

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.notificationsPanel}
      data-testid="settings-notifications-panel"
    >
      <div className={styles.header}>
        <Text weight="semibold" size="sm">
          Notifications
        </Text>
        <Text variant="muted" size="sm">
          Desktop alerts and in-app toasts for task activity.
        </Text>
      </div>

      <div className={styles.group}>
        <ToggleRow
          title="Enable notifications"
          description="Master switch for all notification surfaces."
          checked={preferences.enabled}
          onChange={setEnabled}
        />
        <ToggleRow
          title="Desktop notifications"
          description="Show native OS alerts from the desktop app."
          checked={preferences.desktopEnabled}
          disabled={!preferences.enabled}
          onChange={setDesktopEnabled}
        />
        <ToggleRow
          title="In-app toasts"
          description="Show a compact toast inside Aura."
          checked={preferences.inAppEnabled}
          disabled={!preferences.enabled}
          onChange={setInAppEnabled}
        />
        <ToggleRow
          title="Sound"
          description="Play the default system notification sound."
          checked={preferences.soundEnabled}
          disabled={!preferences.enabled || !preferences.desktopEnabled}
          onChange={setSoundEnabled}
        />
      </div>

      <div className={styles.group}>
        <Text weight="semibold" size="xs">
          Notify When
        </Text>
        <div className={styles.segmented} role="radiogroup" aria-label="Notify when">
          <button
            type="button"
            role="radio"
            aria-checked={preferences.condition === "unfocused"}
            className={styles.segment}
            data-active={preferences.condition === "unfocused" || undefined}
            disabled={!preferences.enabled}
            onClick={() => setCondition("unfocused")}
          >
            Unfocused
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={preferences.condition === "always"}
            className={styles.segment}
            data-active={preferences.condition === "always" || undefined}
            disabled={!preferences.enabled}
            onClick={() => setCondition("always")}
          >
            Always
          </button>
        </div>
      </div>

      <div className={styles.group}>
        <Text weight="semibold" size="xs">
          Event Types
        </Text>
        {Object.values(NotificationKind).map((kind) => (
          <ToggleRow
            key={kind}
            title={NOTIFICATION_KIND_LABELS[kind]}
            description={descriptionForKind(kind)}
            checked={preferences.types[kind]}
            disabled={!preferences.enabled}
            onChange={(checked) => setTypeEnabled(kind, checked)}
          />
        ))}
      </div>

      <div className={styles.group}>
        <Text weight="semibold" size="xs">
          More Surfaces
        </Text>
        <PlaceholderRow title="Browser notifications" />
        <PlaceholderRow title="Mobile push" />
        <PlaceholderRow title="Telegram" />
        <PlaceholderRow title="Email" />
      </div>
    </Panel>
  );
}

interface ToggleRowProps {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: ToggleRowProps): React.ReactElement {
  return (
    <label className={styles.toggleRow} data-disabled={disabled || undefined}>
      <span className={styles.toggleCopy}>
        <span className={styles.toggleTitle}>{title}</span>
        <span className={styles.toggleDescription}>{description}</span>
      </span>
      <input
        className={styles.switchInput}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function PlaceholderRow({ title }: { title: string }): React.ReactElement {
  return (
    <div className={styles.placeholderRow}>
      <span>{title}</span>
      <span className={styles.comingSoon}>Coming soon</span>
    </div>
  );
}

function descriptionForKind(kind: NotificationKind): string {
  switch (kind) {
    case NotificationKind.TaskCompleted:
      return "Successful task completions.";
    case NotificationKind.TaskFailed:
      return "Task failures and blocked runs.";
    case NotificationKind.TaskRetrying:
      return "Retry attempts during a task run.";
    case NotificationKind.LoopEnded:
      return "Automation, process, and loop endings.";
    case NotificationKind.ProjectPushStuck:
      return "Repeated push failures for a project.";
  }
}
