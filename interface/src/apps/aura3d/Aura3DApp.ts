import { Box } from "lucide-react";
import { Aura3DNav } from "./Aura3DNav";
import { Aura3DMainPanel } from "./Aura3DMainPanel";
import { Aura3DSidekickPanel } from "./Aura3DSidekickPanel";
import { Aura3DSidekickTaskbar } from "./Aura3DSidekickTaskbar";
import type { AuraAppModule } from "../types";

export const Aura3DApp: AuraAppModule = {
  id: "aura3d",
  label: "AURA 3D",
  icon: Box,
  basePath: "/3d",
  LeftPanel: Aura3DNav,
  MainPanel: Aura3DMainPanel,
  ResponsiveControls: Aura3DNav,
  SidekickPanel: Aura3DSidekickPanel,
  SidekickTaskbar: Aura3DSidekickTaskbar,
};
