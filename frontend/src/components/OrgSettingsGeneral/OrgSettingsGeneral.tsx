import { Input, Text } from "@cypher-asi/zui";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  teamName: string;
  onTeamNameChange: (value: string) => void;
  teamSaving: boolean;
  teamMessage: string;
}

export function OrgSettingsGeneral({ teamName, onTeamNameChange, teamSaving, teamMessage }: Props) {
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
    </>
  );
}
