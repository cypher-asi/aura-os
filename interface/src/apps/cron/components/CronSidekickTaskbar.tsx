import type { MenuItem } from "@cypher-asi/zui";
import { Cpu, History, Package, ChartNoAxesColumnIncreasing, Logs, Pencil, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useCronSidekickStore, type CronSidekickTab } from "../stores/cron-sidekick-store";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";

const TABS: TabItem[] = [
  { id: "cron", icon: <Cpu size={16} />, title: "Cron" },
  { id: "runs", icon: <History size={16} />, title: "Runs" },
  { id: "artifacts", icon: <Package size={16} />, title: "Artifacts" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
];

const ACTIONS: MenuItem[] = [
  { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

export function CronSidekickTaskbar() {
  const { activeTab, setActiveTab, requestEdit, requestDelete } = useCronSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      requestEdit: s.requestEdit,
      requestDelete: s.requestDelete,
    })),
  );

  const handleAction = (id: string) => {
    if (id === "edit") requestEdit();
    else if (id === "delete") requestDelete();
  };

  return (
    <SidekickTabBar
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as CronSidekickTab)}
      actions={ACTIONS}
      onAction={handleAction}
      alwaysShowMore
    />
  );
}
