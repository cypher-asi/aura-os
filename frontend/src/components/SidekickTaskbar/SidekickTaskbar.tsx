import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, Menu } from "@cypher-asi/zui";
import { Archive, Info, Ellipsis, File, Check, Logs, Gauge, Rows3, Code } from "lucide-react";
import { useSidekick, type SidekickTab } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { hasLinkedWorkspace } from "../../utils/projectWorkspace";
import styles from "../Sidekick/Sidekick.module.css";

const TAB_ICONS: { id: SidekickTab; icon: React.ReactNode; title: string }[] = [
  { id: "specs", icon: <File size={16} />, title: "Specs" },
  { id: "tasks", icon: <Check size={16} />, title: "Tasks" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
  { id: "stats", icon: <Gauge size={16} />, title: "Stats" },
  { id: "sessions", icon: <Rows3 size={16} />, title: "Sessions" },
  { id: "files", icon: <Code size={16} />, title: "Files" },
];

export function SidekickTaskbar() {
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { features } = useAuraCapabilities();
  const canBrowseFiles = features.linkedWorkspace && hasLinkedWorkspace(ctx?.project);

  useEffect(() => {
    if (!canBrowseFiles && activeTab === "files") {
      setActiveTab("tasks");
    }
  }, [activeTab, canBrowseFiles, setActiveTab]);

  useLayoutEffect(() => {
    if (moreOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.right - 180 });
    } else {
      setMenuRect(null);
    }
  }, [moreOpen]);

  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);

  if (!ctx || showInfo) return null;

  const { project, handleArchive } = ctx;
  const visibleTabs = canBrowseFiles ? TAB_ICONS : TAB_ICONS.filter((tab) => tab.id !== "files");

  return (
    <div className={styles.sidekickTaskbar}>
      <div className={styles.sidekickTabBar}>
        {visibleTabs.map(({ id, icon, title }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            iconOnly
            icon={icon}
            title={title}
            aria-label={title}
            onClick={() => setActiveTab(id)}
            aria-pressed={activeTab === id}
            selected={activeTab === id}
          />
        ))}
      </div>
      <div ref={moreBtnRef} className={styles.moreButtonWrap}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<Ellipsis size={16} />}
          onClick={() => setMoreOpen((v) => !v)}
          title="More actions"
          aria-label="More actions"
        />
        {moreOpen &&
          menuRect &&
          createPortal(
            <div
              ref={moreMenuRef}
              className={styles.moreMenu}
              style={{
                position: "fixed",
                top: menuRect.top,
                left: menuRect.left,
                zIndex: 100,
              }}
            >
              <Menu
                items={[
                  ...(project.current_status !== "archived"
                    ? [{ id: "archive", label: "Archive", icon: <Archive size={14} /> }]
                    : []),
                  { id: "info", label: "Project Info", icon: <Info size={14} /> },
                ]}
                onChange={(id) => {
                  setMoreOpen(false);
                  if (id === "archive") handleArchive();
                  if (id === "info") toggleInfo("Project Info", null);
                }}
                background="solid"
                border="solid"
                rounded="md"
                width={180}
                isOpen
              />
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
