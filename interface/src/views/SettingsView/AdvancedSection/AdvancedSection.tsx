import { Panel, Text } from "@cypher-asi/zui";
import styles from "./AdvancedSection.module.css";

export function AdvancedSection() {
  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.advancedPanel}
      data-testid="settings-advanced-panel"
    >
      <Text weight="semibold" size="sm">
        Advanced
      </Text>
      <Text variant="muted" size="sm">
        Settings are managed through environment variables. See <code>.env.example</code> for available options.
      </Text>
    </Panel>
  );
}
