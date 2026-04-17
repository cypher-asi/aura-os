import { Cross } from "lucide-react";
import { FeedbackList } from "./FeedbackList";
import { FeedbackMainPanel } from "./FeedbackMainPanel";
import { FeedbackSidekickPanel } from "./FeedbackSidekickPanel";
import { FeedbackSidekickHeader } from "./FeedbackSidekickHeader";
import type { AuraAppModule } from "../types";

export const FeedbackApp: AuraAppModule = {
  id: "feedback",
  label: "Feedback",
  icon: Cross,
  basePath: "/feedback",
  LeftPanel: FeedbackList,
  MainPanel: FeedbackMainPanel,
  ResponsiveControls: FeedbackList,
  SidekickPanel: FeedbackSidekickPanel,
  SidekickTaskbar: FeedbackSidekickHeader,
};
