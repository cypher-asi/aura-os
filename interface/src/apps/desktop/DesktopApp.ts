import { createElement } from "react";
import { Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { AuraApp } from "../types";

function EmptyPanel() {
  return null;
}

function MainPanel({ children }: { children?: ReactNode }) {
  return createElement("div", { style: { flex: 1, minHeight: 0, overflow: "hidden" } }, children);
}

export const DesktopApp: AuraApp = {
  id: "desktop",
  label: "Desktop",
  icon: Circle,
  basePath: "/desktop",
  LeftPanel: EmptyPanel,
  MainPanel,
};
