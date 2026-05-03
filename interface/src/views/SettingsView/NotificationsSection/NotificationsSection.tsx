import { Panel, Text } from "@cypher-asi/zui";
import styles from "./NotificationsSection.module.css";

export function NotificationsSection() {
  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.notificationsPanel}
      data-testid="settings-notifications-panel"
    >
      <Text weight="semibold" size="sm">
        Notifications
      </Text>
      <Text variant="muted" size="sm">
        Notification settings will appear here in a future release.
      </Text>
    </Panel>
  );
}
