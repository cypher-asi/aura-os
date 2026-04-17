import { useMemo } from "react";
import { Info, MessageSquare } from "lucide-react";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar/SidekickTabBar";
import { useNotesStore } from "../../../stores/notes-store";

export function NotesSidekickTaskbar() {
  const sidekickTab = useNotesStore((s) => s.sidekickTab);
  const setSidekickTab = useNotesStore((s) => s.setSidekickTab);

  const tabs = useMemo<TabItem[]>(
    () => [
      { id: "info", icon: <Info size={16} />, title: "Info" },
      { id: "comments", icon: <MessageSquare size={16} />, title: "Comments" },
    ],
    [],
  );

  return (
    <SidekickTabBar
      tabs={tabs}
      activeTab={sidekickTab}
      onTabChange={(id) => setSidekickTab(id as "info" | "comments")}
    />
  );
}
