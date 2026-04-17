import type { ReactNode } from "react";
import {
  Box,
  Bug,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  Eye,
  Flame,
  Gem,
  Globe,
  Grid3x3,
  HelpCircle,
  Layers,
  Link as LinkIcon,
  MessageCircle,
  Palette,
  Rocket,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type {
  FeedbackCategory,
  FeedbackProduct,
  FeedbackSort,
  FeedbackStatus,
} from "./types";

export const FEEDBACK_SORT_FILTERS: ReadonlyArray<{
  id: FeedbackSort;
  label: string;
  icon: ReactNode;
}> = [
  { id: "latest", label: "Latest", icon: <Clock size={14} /> },
  { id: "popular", label: "Most Popular", icon: <Star size={14} /> },
  { id: "trending", label: "Trending", icon: <Flame size={14} /> },
  { id: "most_voted", label: "Most Voted", icon: <TrendingUp size={14} /> },
  { id: "least_voted", label: "Least Voted", icon: <TrendingDown size={14} /> },
];

export const FEEDBACK_CATEGORY_FILTERS: ReadonlyArray<{
  id: FeedbackCategory;
  label: string;
  icon: ReactNode;
}> = [
  { id: "feature_request", label: "Feature Request", icon: <Sparkles size={14} /> },
  { id: "bug", label: "Bug", icon: <Bug size={14} /> },
  { id: "ui_ux", label: "UI/UX", icon: <Palette size={14} /> },
  { id: "feedback", label: "Feedback", icon: <MessageCircle size={14} /> },
  { id: "question", label: "Question", icon: <HelpCircle size={14} /> },
];

export const FEEDBACK_STATUS_FILTERS: ReadonlyArray<{
  id: FeedbackStatus;
  label: string;
  icon: ReactNode;
}> = [
  { id: "not_started", label: "Not Started", icon: <CircleDashed size={14} /> },
  { id: "in_review", label: "In Review", icon: <Eye size={14} /> },
  { id: "in_progress", label: "In Progress", icon: <CircleDot size={14} /> },
  { id: "done", label: "Done", icon: <CheckCircle2 size={14} /> },
  { id: "deployed", label: "Deployed", icon: <Rocket size={14} /> },
];

export const FEEDBACK_ALL_CATEGORY_ICON: ReactNode = <Layers size={14} />;
export const FEEDBACK_ALL_STATUS_ICON: ReactNode = <Globe size={14} />;

export const FEEDBACK_PRODUCT_FILTERS: ReadonlyArray<{
  id: FeedbackProduct;
  label: string;
  icon: ReactNode;
}> = [
  { id: "aura", label: "AURA", icon: <Box size={14} /> },
  { id: "the_grid", label: "The Grid", icon: <Grid3x3 size={14} /> },
  { id: "wilder_world", label: "Wilder World", icon: <Gem size={14} /> },
  { id: "z_chain", label: "Z Chain", icon: <LinkIcon size={14} /> },
];
