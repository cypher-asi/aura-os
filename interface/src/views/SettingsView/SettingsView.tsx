import { useMemo, useRef } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Navigator } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import { OverlayScrollbar } from "../../components/OverlayScrollbar";
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
  const navScrollRef = useRef<HTMLDivElement>(null);

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
    <div className={styles.root}>
      <header className={styles.titleBar}>
        <span className={styles.title}>Settings</span>
      </header>
      <div className={styles.layout}>
        <aside className={styles.nav}>
          <div ref={navScrollRef} className={styles.navScroll}>
            <Navigator
              items={navItems}
              value={section}
              onChange={(id) => navigate(`/projects/settings/${id}`)}
            />
          </div>
          <OverlayScrollbar scrollRef={navScrollRef} />
        </aside>
        <section className={styles.content}>
          <Pane />
        </section>
      </div>
    </div>
  );
}
