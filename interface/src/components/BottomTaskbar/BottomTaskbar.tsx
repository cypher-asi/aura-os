import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Circle, CreditCard, ChevronRight, ChevronLeft, Settings } from "lucide-react";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAppStore } from "../../stores/app-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { getTaskbarAppsCollapsed, setTaskbarAppsCollapsed } from "../../utils/storage";
import { formatCredits } from "../../utils/format";
import { AppNavRail, TaskbarIconButton, TASKBAR_ICON_SIZE } from "../AppNavRail";
import { useCreditBalance } from "../CreditsBadge/useCreditBalance";
import { FavoriteAgentsStrip } from "./FavoriteAgentsStrip";
import styles from "./BottomTaskbar.module.css";

const TASKBAR_CHEVRON_SIZE = TASKBAR_ICON_SIZE + 1;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function BottomTaskbar() {
  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const activeApp = useAppStore((s) => s.activeApp);
  const time = useClock();
  const navigate = useNavigate();
  const previousPath = useAppUIStore((s) => s.previousPath);
  const { credits } = useCreditBalance();
  const [collapsed, setCollapsed] = useState(() => getTaskbarAppsCollapsed());
  const [creditsExpanded, setCreditsExpanded] = useState(false);
  const creditsLabel = credits !== null ? formatCredits(credits) : "---";

  const toggleAppsCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      setTaskbarAppsCollapsed(next);
      return next;
    });
  };

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <TaskbarIconButton
          selected={activeApp.id === "desktop"}
          icon={<Circle size={TASKBAR_ICON_SIZE} />}
          title="Desktop"
          aria-label="Desktop"
          onClick={() => {
            if (activeApp.id === "desktop") {
              if (previousPath) navigate(previousPath);
            } else {
              navigate("/desktop");
            }
          }}
        />
        <AppNavRail
          layout="taskbar"
          allowReorder
          excludeIds={["profile"]}
          {...(collapsed && { includeIds: ["agents", "projects"] })}
        />
        <TaskbarIconButton
          icon={
            collapsed ? (
              <ChevronRight size={TASKBAR_CHEVRON_SIZE} />
            ) : (
              <ChevronLeft size={TASKBAR_CHEVRON_SIZE} />
            )
          }
          onClick={toggleAppsCollapsed}
          aria-label={collapsed ? "Expand apps" : "Collapse apps"}
        />
      </div>

      <div className={styles.center}>
        <FavoriteAgentsStrip />
      </div>

      <div className={styles.right}>
        <div className={styles.rightPrimary}>
          <TaskbarIconButton
            icon={
              creditsExpanded ? (
                <ChevronRight size={TASKBAR_CHEVRON_SIZE} />
              ) : (
                <ChevronLeft size={TASKBAR_CHEVRON_SIZE} />
              )
            }
            onClick={() => setCreditsExpanded((current) => !current)}
            aria-label={creditsExpanded ? "Hide credits balance" : "Show credits balance"}
          />
          {creditsExpanded ? (
            <span className={styles.creditsSummary} aria-live="polite">
              {creditsLabel}
            </span>
          ) : null}
          <TaskbarIconButton
            icon={<CreditCard size={TASKBAR_ICON_SIZE} />}
            title="Credits"
            aria-label="Credits"
            onClick={openBuyCredits}
          />
          <TaskbarIconButton
            icon={<Settings size={TASKBAR_ICON_SIZE} />}
            title="Team settings"
            aria-label="Team settings"
            onClick={openOrgSettings}
          />
          <AppNavRail
            layout="taskbar"
            includeIds={["profile"]}
            ariaLabel="Profile shortcut"
          />
        </div>
        <span className={styles.clock}>{time}</span>
      </div>
    </div>
  );
}
