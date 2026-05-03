import { Panel, Text } from "@cypher-asi/zui";
import styles from "./KeyboardSection.module.css";

export function KeyboardSection() {
  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.keyboardPanel}
      data-testid="settings-keyboard-panel"
    >
      <Text weight="semibold" size="sm">
        Keyboard
      </Text>
      <Text variant="muted" size="sm">
        Keyboard shortcut customization will appear here in a future release.
      </Text>
    </Panel>
  );
}
