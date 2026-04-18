import type { ReactNode } from "react";
import {
  Box,
  Bug,
  CheckCircle2,
  Circle,
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
import {
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_PRODUCT_OPTIONS,
  FEEDBACK_STATUS_OPTIONS,
  type FeedbackCategory,
  type FeedbackProduct,
  type FeedbackSort,
  type FeedbackStatus,
} from "./types";
import type { FeedbackFilterOption } from "./FeedbackFilterTree";

/**
 * Presentational filter data for the Feedback sidebar. The string labels are
 * derived from `types.ts` option tables so we never duplicate them; this
 * module only owns the per-id icons.
 */

const CATEGORY_ICONS: Record<FeedbackCategory, ReactNode> = {
  feature_request: <Sparkles size={14} />,
  bug: <Bug size={14} />,
  ui_ux: <Palette size={14} />,
  feedback: <MessageCircle size={14} />,
  question: <HelpCircle size={14} />,
};

const STATUS_ICONS: Record<FeedbackStatus, ReactNode> = {
  not_started: <CircleDashed size={14} />,
  in_review: <Eye size={14} />,
  in_progress: <CircleDot size={14} />,
  done: <CheckCircle2 size={14} />,
  deployed: <Rocket size={14} />,
};

const PRODUCT_ICONS: Record<FeedbackProduct, ReactNode> = {
  aura: <Box size={14} />,
  the_grid: <Grid3x3 size={14} />,
  wilder_world: <Gem size={14} />,
  z_chain: <LinkIcon size={14} />,
  zero: <Circle size={14} />,
};

const SORT_LABELS: Record<FeedbackSort, string> = {
  latest: "Latest",
  popular: "Most Popular",
  trending: "Trending",
  most_voted: "Most Voted",
  least_voted: "Least Voted",
};

const SORT_ICONS: Record<FeedbackSort, ReactNode> = {
  latest: <Clock size={14} />,
  popular: <Star size={14} />,
  trending: <Flame size={14} />,
  most_voted: <TrendingUp size={14} />,
  least_voted: <TrendingDown size={14} />,
};

export const FEEDBACK_CATEGORY_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackCategory>
> = FEEDBACK_CATEGORY_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  icon: CATEGORY_ICONS[option.value],
}));

export const FEEDBACK_STATUS_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackStatus>
> = FEEDBACK_STATUS_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  icon: STATUS_ICONS[option.value],
}));

export const FEEDBACK_PRODUCT_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackProduct>
> = FEEDBACK_PRODUCT_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  icon: PRODUCT_ICONS[option.value],
}));

const SORT_ORDER: ReadonlyArray<FeedbackSort> = [
  "latest",
  "popular",
  "trending",
  "most_voted",
  "least_voted",
];

export const FEEDBACK_SORT_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackSort>
> = SORT_ORDER.map((id) => ({
  id,
  label: SORT_LABELS[id],
  icon: SORT_ICONS[id],
}));

export const FEEDBACK_ALL_CATEGORY_ICON: ReactNode = <Layers size={14} />;
export const FEEDBACK_ALL_STATUS_ICON: ReactNode = <Globe size={14} />;
