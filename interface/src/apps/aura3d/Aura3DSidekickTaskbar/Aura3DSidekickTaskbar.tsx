import { ImageIcon, Box } from "lucide-react";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";
import { useAura3DStore, type Aura3DSidekickTab } from "../../../stores/aura3d-store";

const TABS: readonly TabItem[] = [
  { id: "images", icon: <ImageIcon size={16} />, title: "Images" },
  { id: "models", icon: <Box size={16} />, title: "3D Models" },
];

const isValidTab = (id: string): id is Aura3DSidekickTab =>
  id === "images" || id === "models";

export function Aura3DSidekickTaskbar() {
  const sidekickTab = useAura3DStore((s) => s.sidekickTab);
  const setSidekickTab = useAura3DStore((s) => s.setSidekickTab);

  return (
    <SidekickTabBar
      tabs={TABS}
      activeTab={sidekickTab}
      onTabChange={(id) => {
        if (isValidTab(id)) setSidekickTab(id);
      }}
    />
  );
}
