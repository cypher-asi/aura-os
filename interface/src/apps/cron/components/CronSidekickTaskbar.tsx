import { Button } from "@cypher-asi/zui";
import { useShallow } from "zustand/react/shallow";
import { History, Package, ChartNoAxesColumnIncreasing, Logs } from "lucide-react";
import { useCronSidekickStore, type CronSidekickTab } from "../stores/cron-sidekick-store";
import styles from "../../../components/Sidekick/Sidekick.module.css";

const TABS: { id: CronSidekickTab; icon: React.ReactNode; title: string }[] = [
  { id: "runs", icon: <History size={16} />, title: "Runs" },
  { id: "artifacts", icon: <Package size={16} />, title: "Artifacts" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
];

export function CronSidekickTaskbar() {
  const { activeTab, setActiveTab } = useCronSidekickStore(
    useShallow((s) => ({ activeTab: s.activeTab, setActiveTab: s.setActiveTab })),
  );

  return (
    <div className={styles.sidekickTaskbar}>
      <div className={styles.sidekickTabBar}>
        {TABS.map(({ id, icon, title }) => (
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
    </div>
  );
}
