import { Page, Panel, Text } from "@cypher-asi/zui";
import { formatBuildTime, getBuildInfo } from "../../lib/build-info";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  const build = getBuildInfo();
  const channelLabel = build.channel.charAt(0).toUpperCase() + build.channel.slice(1);

  return (
    <Page title="Settings" subtitle="Configuration status">
      <Panel
        variant="solid"
        border="solid"
        borderRadius="md"
        className={styles.settingsPanel}
        data-testid="settings-about-panel"
      >
        <Text weight="semibold" size="sm">
          About
        </Text>
        <dl className={styles.infoGrid}>
          <dt>
            <Text as="span" variant="muted" size="sm">
              Version
            </Text>
          </dt>
          <dd>
            <Text as="span" size="sm" className={styles.monoText} data-testid="settings-version">
              {build.version}
            </Text>{" "}
            <Text as="span" variant="muted" size="sm" data-testid="settings-channel">
              ({channelLabel})
            </Text>
          </dd>
          <dt>
            <Text as="span" variant="muted" size="sm">
              Commit
            </Text>
          </dt>
          <dd>
            <Text as="span" size="sm" className={styles.monoText} data-testid="settings-commit">
              {build.commit}
            </Text>
          </dd>
          <dt>
            <Text as="span" variant="muted" size="sm">
              Built
            </Text>
          </dt>
          <dd>
            <Text as="span" size="sm" data-testid="settings-build-time">
              {formatBuildTime(build.buildTime)}
            </Text>
          </dd>
        </dl>
      </Panel>
      <Panel variant="solid" border="solid" borderRadius="md" className={styles.settingsPanel}>
        <Text variant="muted" size="sm">
          Settings are managed through environment variables. See <code>.env.example</code> for available options.
        </Text>
      </Panel>
    </Page>
  );
}
