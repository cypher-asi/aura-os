import { Plug } from "lucide-react";
import { IntegrationsNav } from "./IntegrationsNav";
import { IntegrationsMainPanel } from "./IntegrationsMainPanel";
import type { AuraAppModule } from "../types";

export const IntegrationsApp: AuraAppModule = {
  id: "integrations",
  label: "Integrations",
  icon: Plug,
  basePath: "/integrations",
  LeftPanel: IntegrationsNav,
  MainPanel: IntegrationsMainPanel,
  ResponsiveControls: IntegrationsNav,
  searchPlaceholder: "Search integrations",
};
