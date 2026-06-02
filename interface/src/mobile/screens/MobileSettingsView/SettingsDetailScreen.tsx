import type { SettingsSection } from "../../../views/SettingsView/sections";
import styles from "./MobileSettingsView.module.css";

interface Props {
  entry: SettingsSection;
}

export function SettingsDetailScreen({ entry }: Props) {
  const { Pane } = entry;
  const detailTestId = `mobile-settings-detail-${entry.id}`;
  const aboutCompatTestId =
    entry.id === "about" ? "mobile-settings-about-panel" : undefined;

  return (
    <main
      className={styles.settingsRoot}
      data-testid={detailTestId}
    >
      <header className={styles.detailHeader}>
        <h1 className={styles.detailTitle}>{entry.label}</h1>
      </header>

      <section
        className={styles.detailBody}
        data-testid={aboutCompatTestId}
      >
        <Pane />
      </section>
    </main>
  );
}
