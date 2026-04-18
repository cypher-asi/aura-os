import { Store } from "lucide-react";
import { MarketplaceSidebar } from "./MarketplaceSidebar";
import { MarketplaceMainPanel } from "./MarketplaceMainPanel";
import { MarketplaceSidekickPanel } from "./MarketplaceSidekickPanel";
import { MarketplaceSidekickTaskbar } from "./MarketplaceSidekickTaskbar";
import type { AuraAppModule } from "../types";

export const MarketplaceApp: AuraAppModule = {
  id: "marketplace",
  label: "Marketplace",
  icon: Store,
  basePath: "/marketplace",
  LeftPanel: MarketplaceSidebar,
  DesktopLeftMenuPane: MarketplaceSidebar,
  MainPanel: MarketplaceMainPanel,
  ResponsiveControls: MarketplaceSidebar,
  SidekickPanel: MarketplaceSidekickPanel,
  SidekickTaskbar: MarketplaceSidekickTaskbar,
  searchPlaceholder: "Search talent",
};
