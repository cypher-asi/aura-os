import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  ClipboardList,
  Repeat,
  RotateCcw,
  ScrollText,
} from "lucide-react";
import {
  useDebugSidekickStore,
  type DebugSidekickTab,
} from "../../stores/debug-sidekick-store";
import {
  SidekickTabBar,
  type TabItem,
} from "../../../../components/SidekickTabBar";

const TABS: TabItem[] = [
  { id: "run", icon: <ClipboardList size={16} />, title: "Run" },
  { id: "events", icon: <Activity size={16} />, title: "All events" },
  { id: "llm", icon: <Brain size={16} />, title: "LLM calls" },
  { id: "iterations", icon: <Repeat size={16} />, title: "Iterations" },
  { id: "blockers", icon: <AlertTriangle size={16} />, title: "Blockers" },
  { id: "retries", icon: <RotateCcw size={16} />, title: "Retries" },
  { id: "stats", icon: <BarChart3 size={16} />, title: "Stats" },
  { id: "tasks", icon: <ScrollText size={16} />, title: "Tasks" },
];

export function DebugSidekickTaskbar() {
  const activeTab = useDebugSidekickStore((s) => s.activeTab);
  const setActiveTab = useDebugSidekickStore((s) => s.setActiveTab);

  return (
    <div data-agent-surface="sidekick-header">
      <SidekickTabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as DebugSidekickTab)}
        alwaysShowMore
      />
    </div>
  );
}
