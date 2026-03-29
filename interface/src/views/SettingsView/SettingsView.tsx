import { Page, Panel, Text } from "@cypher-asi/zui";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  return (
    <Page title="Settings" subtitle="Configuration status">
      <Panel variant="solid" border="solid" borderRadius="md" className={styles.settingsPanel}>
        <Text variant="muted" size="sm">
          Settings are managed through environment variables. See <code>.env.example</code> for available options.
        </Text>
      </Panel>
    </Page>
  );
}
