import { Info, ListTree, MessageSquare } from "lucide-react";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar/SidekickTabBar";
import { useNotesStore } from "../../../stores/notes-store";

type NotesSidekickTab = "toc" | "info" | "comments";

const TABS: readonly TabItem[] = [
  { id: "toc", icon: <ListTree size={16} />, title: "Table of contents" },
  { id: "info", icon: <Info size={16} />, title: "Info" },
  { id: "comments", icon: <MessageSquare size={16} />, title: "Comments" },
];

function isNotesSidekickTab(id: string): id is NotesSidekickTab {
  return id === "toc" || id === "info" || id === "comments";
}

export function NotesSidekickTaskbar() {
  const sidekickTab = useNotesStore((s) => s.sidekickTab);
  const setSidekickTab = useNotesStore((s) => s.setSidekickTab);

  return (
    <SidekickTabBar
      tabs={TABS}
      activeTab={sidekickTab}
      onTabChange={(id) => {
        if (isNotesSidekickTab(id)) setSidekickTab(id);
      }}
    />
  );
}
