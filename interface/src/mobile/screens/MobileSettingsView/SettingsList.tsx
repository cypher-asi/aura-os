import { ChevronRight } from "lucide-react";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../../../views/SettingsView/sections";
import styles from "./MobileSettingsView.module.css";

interface Props {
  onSelect: (id: SettingsSectionId) => void;
}

export function SettingsList({ onSelect }: Props) {
  return (
    <main className={styles.settingsRoot} data-testid="mobile-settings-list">
      <header className={styles.settingsHeader}>
        <h1>Settings</h1>
        <p>Configure AURA</p>
      </header>

      <nav className={styles.rowList} aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              className={styles.row}
              onClick={() => onSelect(section.id)}
              data-testid={`mobile-settings-row-${section.id}`}
            >
              <span className={styles.rowIcon}>
                <Icon size={18} />
              </span>
              <span className={styles.rowLabel}>{section.label}</span>
              <span className={styles.rowChevron}>
                <ChevronRight size={16} />
              </span>
            </button>
          );
        })}
      </nav>
    </main>
  );
}
