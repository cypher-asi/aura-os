import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingsSection } from "../../../views/SettingsView/sections";
import styles from "./MobileSettingsView.module.css";

interface Props {
  entry: SettingsSection;
  onBack: () => void;
}

export function SettingsDetailScreen({ entry, onBack }: Props) {
  const { t } = useTranslation("settings");
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
        <button
          type="button"
          className={styles.backButton}
          onClick={onBack}
          aria-label="Back to settings"
          data-testid="mobile-settings-back"
        >
          <ArrowLeft size={18} />
          <span>{t("title", { defaultValue: "Settings" })}</span>
        </button>
        <h1 className={styles.detailTitle}>{t(entry.labelKey, { defaultValue: entry.label })}</h1>
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
