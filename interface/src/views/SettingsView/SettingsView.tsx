import { useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Navigator, Page } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  getSettingsSection,
  isSettingsSectionId,
} from "./sections";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();

  const navItems = useMemo<NavigatorItemProps[]>(
    () =>
      SETTINGS_SECTIONS.map((s) => {
        const Icon = s.icon;
        return { id: s.id, label: s.label, icon: <Icon size={14} /> };
      }),
    [],
  );

  if (!section || !isSettingsSectionId(section)) {
    return <Navigate to={`/projects/settings/${DEFAULT_SETTINGS_SECTION}`} replace />;
  }

  const { Pane } = getSettingsSection(section);

  return (
    <Page title="Settings">
      <div className={styles.layout}>
        <aside className={styles.nav}>
          <Navigator
            items={navItems}
            value={section}
            onChange={(id) => navigate(`/projects/settings/${id}`)}
          />
        </aside>
        <section className={styles.content}>
          <Pane />
        </section>
      </div>
    </Page>
  );
}
