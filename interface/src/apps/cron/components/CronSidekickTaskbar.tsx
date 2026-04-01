import { Button } from "@cypher-asi/zui";
import { History, Package, ChartNoAxesColumnIncreasing, Logs } from "lucide-react";
import { useCronSidekickStore, type CronSidekickTab } from "../stores/cron-sidekick-store";

const TABS: { id: CronSidekickTab; icon: React.ReactNode; title: string }[] = [
  { id: "runs", icon: <History size={16} />, title: "Runs" },
  { id: "artifacts", icon: <Package size={16} />, title: "Artifacts" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
];

export function CronSidekickTaskbar() {
  const { activeTab, setActiveTab } = useCronSidekickStore();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 8px" }}>
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
          selected={activeTab === id}
        />
      ))}
    </div>
  );
}
