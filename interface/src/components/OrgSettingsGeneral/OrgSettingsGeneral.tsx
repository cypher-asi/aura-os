import { Input, Text } from "@cypher-asi/zui";
import { formatBuildTime, getBuildInfo } from "../../lib/build-info";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  teamName: string;
  onTeamNameChange: (value: string) => void;
  teamSaving: boolean;
  teamMessage: string;
}

export function OrgSettingsGeneral({ teamName, onTeamNameChange, teamSaving, teamMessage }: Props) {
  const build = getBuildInfo();
  const channelLabel = build.channel.charAt(0).toUpperCase() + build.channel.slice(1);

  return (
    <>
      <h2 className={styles.sectionTitle}>General</h2>

      <div className={styles.settingsGroupLabel}>Team</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Team Name</span>
            <span className={styles.rowDescription}>
              The display name for your team
            </span>
          </div>
          <div className={styles.rowControl}>
            <Input
              size="sm"
              value={teamName}
              onChange={(e) => onTeamNameChange(e.target.value)}
              placeholder="My Team"
              className={styles.inputWidth200}
            />
          </div>
        </div>
      </div>
      {(teamSaving || teamMessage) && (
        <Text variant="muted" size="sm" className={styles.topMarginSm}>
          {teamSaving ? "Saving..." : teamMessage}
        </Text>
      )}

      <div className={styles.settingsGroupLabel}>About</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Version</span>
            <span className={styles.rowDescription}>Current build of Aura</span>
          </div>
          <div className={styles.rowControl}>
            <Text as="span" size="sm" data-testid="settings-version">
              {build.version}
            </Text>
            <Text as="span" variant="muted" size="sm" data-testid="settings-channel">
              ({channelLabel})
            </Text>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Commit</span>
            <span className={styles.rowDescription}>Source revision this build was cut from</span>
          </div>
          <div className={styles.rowControl}>
            <Text as="span" size="sm" data-testid="settings-commit">
              {build.commit}
            </Text>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Built</span>
            <span className={styles.rowDescription}>When this build was produced</span>
          </div>
          <div className={styles.rowControl}>
            <Text as="span" size="sm" data-testid="settings-build-time">
              {formatBuildTime(build.buildTime)}
            </Text>
          </div>
        </div>
      </div>
    </>
  );
}
