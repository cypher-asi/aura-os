import { GitCommitVertical } from "lucide-react";
import { FeedList } from "./FeedList";
import { FeedMainPanel } from "./FeedMainPanel";
import { FeedProvider } from "./FeedProvider";
import type { AuraApp } from "../types";

export const FeedApp: AuraApp = {
  id: "feed",
  label: "Feed",
  icon: GitCommitVertical,
  basePath: "/feed",
  LeftPanel: FeedList,
  MainPanel: FeedMainPanel,
  Provider: FeedProvider,
};
