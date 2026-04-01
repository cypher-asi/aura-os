import { Workflow, History, Activity, ChartNoAxesColumnIncreasing, Logs } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useProcessSidekickStore, type ProcessSidekickTab } from "../stores/process-sidekick-store";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";

const TABS: TabItem[] = [
  { id: "process", icon: <Workflow size={16} />, title: "Process" },
  { id: "runs", icon: <History size={16} />, title: "Runs" },
  { id: "events", icon: <Activity size={16} />, title: "Events" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
];

export function ProcessSidekickTaskbar() {
  const { activeTab, setActiveTab } = useProcessSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
    })),
  );

  return (
    <SidekickTabBar
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as ProcessSidekickTab)}
      alwaysShowMore
    />
  );
}
