import { Panel, Text } from "@cypher-asi/zui";
import { formatBuildTime, getBuildInfo } from "../../../lib/build-info";
import {
  UpdateControl,
  formatLastChecked,
  useUpdateStatus,
} from "../../../components/UpdateControl";
import styles from "./AboutSection.module.css";

export function AboutSection() {
  const build = getBuildInfo();
  const channelLabel = build.channel.charAt(0).toUpperCase() + build.channel.slice(1);
  const { lastCheckedAt } = useUpdateStatus();
  const lastCheckedLabel = formatLastChecked(lastCheckedAt);

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.aboutPanel}
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
          <UpdateControl showLastChecked={false} />
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
        {lastCheckedLabel ? (
          <>
            <dt>
              <Text as="span" variant="muted" size="sm">
                Last checked
              </Text>
            </dt>
            <dd>
              <Text as="span" size="sm" data-testid="settings-update-last-checked">
                {lastCheckedLabel}
              </Text>
            </dd>
          </>
        ) : null}
      </dl>
    </Panel>
  );
}
