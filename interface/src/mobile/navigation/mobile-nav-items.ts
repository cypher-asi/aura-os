import { ChartNoAxesColumnIncreasing, Brain, Cpu } from "lucide-react";
import type { MobileMoreNavId } from "./MobileBottomNav";

export const MOBILE_MORE_NAV_ITEMS: Array<{
  id: MobileMoreNavId;
  label: string;
  icon: typeof Brain;
}> = [
  { id: "process", label: "Process", icon: Cpu },
  { id: "stats", label: "Stats", icon: ChartNoAxesColumnIncreasing },
];
