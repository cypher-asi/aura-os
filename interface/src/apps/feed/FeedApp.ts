import { GitCommitVertical } from "lucide-react";
import { FeedList } from "./FeedList";
import { FeedMainPanel } from "./FeedMainPanel";
import { FeedSidekickPanel } from "./FeedSidekickPanel";
import { FeedSidekickHeader } from "./FeedSidekickHeader";
import type { AuraAppModule } from "../types";

export const FeedApp: AuraAppModule = {
  id: "feed",
  label: "Feed",
  icon: GitCommitVertical,
  basePath: "/feed",
  LeftPanel: FeedList,
  MainPanel: FeedMainPanel,
  ResponsiveControls: FeedList,
  SidekickPanel: FeedSidekickPanel,
  SidekickTaskbar: FeedSidekickHeader,
};
