import type { MenuItem } from "@cypher-asi/zui";
import { Cpu, History, Activity, BarChart3, ScrollText, Settings, Link2, Pencil, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useProcessSidekickStore, type ProcessSidekickTab, type NodeSidekickTab } from "../stores/process-sidekick-store";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";

const PROCESS_TABS: TabItem[] = [
  { id: "process", icon: <Cpu size={16} />, title: "Process" },
  { id: "runs", icon: <History size={16} />, title: "Runs" },
  { id: "events", icon: <Activity size={16} />, title: "Events" },
  { id: "stats", icon: <BarChart3 size={16} />, title: "Stats" },
  { id: "log", icon: <ScrollText size={16} />, title: "Log" },
];

const NODE_TABS: TabItem[] = [
  { id: "info", icon: <Cpu size={16} />, title: "Node Info" },
  { id: "config", icon: <Settings size={16} />, title: "Config" },
  { id: "connections", icon: <Link2 size={16} />, title: "Connections" },
];

const PROCESS_ACTIONS: MenuItem[] = [
  { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

const NODE_ACTIONS: MenuItem[] = [
  { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

export function ProcessSidekickTaskbar() {
  const {
    activeTab, setActiveTab,
    activeNodeTab, setActiveNodeTab,
    selectedNode,
    requestEdit, requestDelete,
  } = useProcessSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      activeNodeTab: s.activeNodeTab,
      setActiveNodeTab: s.setActiveNodeTab,
      selectedNode: s.selectedNode,
      requestEdit: s.requestEdit,
      requestDelete: s.requestDelete,
    })),
  );

  const handleAction = (id: string) => {
    if (id === "edit") requestEdit();
    else if (id === "delete") requestDelete();
  };

  if (selectedNode) {
    return (
      <SidekickTabBar
        tabs={NODE_TABS}
        activeTab={activeNodeTab}
        onTabChange={(id) => setActiveNodeTab(id as NodeSidekickTab)}
        actions={NODE_ACTIONS}
        onAction={handleAction}
        alwaysShowMore
      />
    );
  }

  return (
    <SidekickTabBar
      tabs={PROCESS_TABS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as ProcessSidekickTab)}
      actions={PROCESS_ACTIONS}
      onAction={handleAction}
      alwaysShowMore
    />
  );
}
