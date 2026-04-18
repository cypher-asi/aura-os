export type FeedbackCategory =
  | "feature_request"
  | "bug"
  | "ui_ux"
  | "feedback"
  | "question";

export type FeedbackStatus =
  | "not_started"
  | "in_review"
  | "in_progress"
  | "done"
  | "deployed";

export type FeedbackSort =
  | "latest"
  | "popular"
  | "trending"
  | "most_voted"
  | "least_voted";

export type ViewerVote = "up" | "down" | "none";

export type FeedbackProduct =
  | "aura"
  | "the_grid"
  | "wilder_world"
  | "z_chain"
  | "zero";

/** Product the Aura OS shell tags new feedback with unless the user picks another. */
export const DEFAULT_FEEDBACK_PRODUCT: FeedbackProduct = "aura";

export interface FeedbackAuthor {
  name: string;
  avatarUrl?: string;
  type: "user" | "agent";
}

export interface FeedbackItem {
  id: string;
  author: FeedbackAuthor;
  title: string;
  body: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  product: FeedbackProduct;
  upvotes: number;
  downvotes: number;
  voteScore: number;
  viewerVote: ViewerVote;
  commentCount: number;
  createdAt: string;
}

export interface FeedbackComment {
  id: string;
  itemId: string;
  author: FeedbackAuthor;
  text: string;
  createdAt: string;
}

export interface FeedbackDraft {
  title: string;
  body: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  product: FeedbackProduct;
}

export const FEEDBACK_CATEGORY_OPTIONS: ReadonlyArray<{
  value: FeedbackCategory;
  label: string;
}> = [
  { value: "feature_request", label: "Feature Request" },
  { value: "bug", label: "Bug" },
  { value: "ui_ux", label: "UI/UX" },
  { value: "feedback", label: "Feedback" },
  { value: "question", label: "Question" },
];

export const FEEDBACK_STATUS_OPTIONS: ReadonlyArray<{
  value: FeedbackStatus;
  label: string;
}> = [
  { value: "not_started", label: "Not Started" },
  { value: "in_review", label: "In Review" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "deployed", label: "Deployed" },
];

export const FEEDBACK_PRODUCT_OPTIONS: ReadonlyArray<{
  value: FeedbackProduct;
  label: string;
}> = [
  { value: "aura", label: "AURA" },
  { value: "the_grid", label: "The GRID" },
  { value: "wilder_world", label: "Wilder World" },
  { value: "z_chain", label: "Z Chain" },
  { value: "zero", label: "ZERO" },
];

export function categoryLabel(category: FeedbackCategory): string {
  const match = FEEDBACK_CATEGORY_OPTIONS.find((o) => o.value === category);
  return match?.label ?? category;
}

export function statusLabel(status: FeedbackStatus): string {
  const match = FEEDBACK_STATUS_OPTIONS.find((o) => o.value === status);
  return match?.label ?? status;
}
