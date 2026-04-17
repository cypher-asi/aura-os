import { apiFetch } from "./core";
import type {
  FeedbackCategory,
  FeedbackSort,
  FeedbackStatus,
  ViewerVote,
} from "../apps/feedback/types";

export interface FeedbackItemDto {
  id: string;
  profileId: string;
  eventType: string;
  postType?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  category: FeedbackCategory;
  status: FeedbackStatus;
  createdAt?: string | null;
  commentCount: number;
  upvotes: number;
  downvotes: number;
  voteScore: number;
  viewerVote: ViewerVote;
  authorName?: string | null;
  authorAvatar?: string | null;
}

export interface FeedbackVoteResultDto {
  upvotes: number;
  downvotes: number;
  voteScore: number;
  viewerVote: ViewerVote;
}

export interface FeedbackCommentDto {
  id: string;
  activityEventId: string;
  profileId: string;
  content: string;
  createdAt?: string | null;
  authorName?: string | null;
  authorAvatar?: string | null;
}

export interface CreateFeedbackInput {
  title?: string;
  body: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
}

export interface FeedbackListParams {
  sort?: FeedbackSort;
  limit?: number;
  offset?: number;
}

function buildListQuery(params?: FeedbackListParams): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  if (params.sort) usp.set("sort", params.sort);
  if (params.limit != null) usp.set("limit", String(params.limit));
  if (params.offset != null) usp.set("offset", String(params.offset));
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const feedbackApi = {
  list: (params?: FeedbackListParams): Promise<FeedbackItemDto[]> =>
    apiFetch<FeedbackItemDto[]>(`/api/feedback${buildListQuery(params)}`),

  get: (postId: string): Promise<FeedbackItemDto> =>
    apiFetch<FeedbackItemDto>(`/api/feedback/${postId}`),

  create: (input: CreateFeedbackInput): Promise<FeedbackItemDto> =>
    apiFetch<FeedbackItemDto>("/api/feedback", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateStatus: (postId: string, status: FeedbackStatus): Promise<FeedbackItemDto> =>
    apiFetch<FeedbackItemDto>(`/api/feedback/${postId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  listComments: (postId: string): Promise<FeedbackCommentDto[]> =>
    apiFetch<FeedbackCommentDto[]>(`/api/feedback/${postId}/comments`),

  addComment: (postId: string, content: string): Promise<FeedbackCommentDto> =>
    apiFetch<FeedbackCommentDto>(`/api/feedback/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  castVote: (postId: string, vote: ViewerVote): Promise<FeedbackVoteResultDto> =>
    apiFetch<FeedbackVoteResultDto>(`/api/feedback/${postId}/vote`, {
      method: "POST",
      body: JSON.stringify({ vote }),
    }),
};
