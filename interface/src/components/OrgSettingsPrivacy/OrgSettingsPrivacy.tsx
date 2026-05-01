import { useState } from "react";
import { Button } from "@cypher-asi/zui";
import { optOut, optIn, isAnalyticsOptedOut } from "../../lib/analytics";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

export function OrgSettingsPrivacy() {
  const [optedOut, setOptedOut] = useState(isAnalyticsOptedOut);

  const handleToggle = () => {
    if (optedOut) {
      optIn();
      setOptedOut(false);
    } else {
      optOut();
      setOptedOut(true);
    }
  };

  return (
    <>
      <h2 className={styles.sectionTitle}>Privacy</h2>

      <div className={styles.settingsGroupLabel}>Usage Analytics</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Share anonymous usage data</span>
            <span className={styles.rowDescription}>
              Help improve AURA by sharing anonymous usage data.
            </span>
          </div>
          <div className={styles.rowControl}>
            <Button
              variant={optedOut ? "primary" : "ghost"}
              size="sm"
              onClick={handleToggle}
            >
              {optedOut ? "Opt In" : "Opt Out"}
            </Button>
          </div>
        </div>
      </div>
      <p className={styles.sectionIntro} style={{ marginTop: 0 }}>
        No personal information, file paths, or conversation content is ever
        collected. Only anonymous usage patterns are tracked to help us improve
        the product.
      </p>
    </>
  );
}
