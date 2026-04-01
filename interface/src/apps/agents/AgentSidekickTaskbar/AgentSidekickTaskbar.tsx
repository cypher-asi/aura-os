import { useMemo } from "react";
import type { MenuItem } from "@cypher-asi/zui";
import {
  User,
  MessageSquare,
  Zap,
  FolderOpen,
  Check,
  Cpu,
  Logs,
  ChartNoAxesColumnIncreasing,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAgentSidekickStore, type AgentSidekickTab } from "../stores/agent-sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useSelectedAgent } from "../stores";
import { useAuth } from "../../../stores/auth-store";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";

const TAB_ICONS: TabItem[] = [
  { id: "profile", icon: <User size={16} />, title: "Profile" },
  { id: "chats", icon: <MessageSquare size={16} />, title: "Chats" },
  { id: "skills", icon: <Zap size={16} />, title: "Skills" },
  { id: "projects", icon: <FolderOpen size={16} />, title: "Projects" },
  { id: "tasks", icon: <Check size={16} />, title: "Tasks" },
  { id: "crons", icon: <Cpu size={16} />, title: "Crons" },
  { id: "logs", icon: <Logs size={16} />, title: "Logs" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
];

export function AgentSidekickTaskbar() {
  const { activeTab, setActiveTab, requestEdit, requestDelete } = useAgentSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      requestEdit: s.requestEdit,
      requestDelete: s.requestDelete,
    })),
  );
  const { selectedAgent } = useSelectedAgent();
  const { user } = useAuth();

  const isOwnAgent =
    !!user?.network_user_id &&
    !!selectedAgent &&
    user.network_user_id === selectedAgent.user_id;

  const actions = useMemo<MenuItem[]>(
    () =>
      isOwnAgent
        ? [
            { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
            { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
          ]
        : [],
    [isOwnAgent],
  );

  const handleAction = (id: string) => {
    if (id === "edit") requestEdit();
    else if (id === "delete") requestDelete();
  };

  return (
    <SidekickTabBar
      tabs={TAB_ICONS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as AgentSidekickTab)}
      actions={actions}
      onAction={handleAction}
      alwaysShowMore={isOwnAgent}
    />
  );
}
