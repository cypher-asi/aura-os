import { Box } from "lucide-react";
import { Aura3DNav } from "./Aura3DNav";
import { Aura3DMainPanel } from "./Aura3DMainPanel";
import type { AuraAppModule } from "../types";

export const Aura3DApp: AuraAppModule = {
  id: "aura3d",
  label: "AURA 3D",
  icon: Box,
  basePath: "/3d",
  LeftPanel: Aura3DNav,
  MainPanel: Aura3DMainPanel,
  ResponsiveControls: Aura3DNav,
};
