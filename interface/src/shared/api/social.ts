import type { Follow, DailyCommitActivity } from "../types";
import { apiFetch } from "./core";

export const followsApi = {
  follow: (targetProfileId: string) =>
    apiFetch<Follow>("/api/follows", {
      method: "POST",
      body: JSON.stringify({ target_profile_id: targetProfileId }),
    }),
  unfollow: (targetProfileId: string) =>
    apiFetch<void>(`/api/follows/${targetProfileId}`, {
      method: "DELETE",
    }),
  list: () => apiFetch<Follow[]>("/api/follows"),
  check: (targetProfileId: string) =>
    apiFetch<{ following: boolean }>(`/api/follows/check/${targetProfileId}`),
};

export const usersApi = {
  me: () => apiFetch<{
    id: string;
    zos_user_id: string | null;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    location: string | null;
    website: string | null;
    profile_id: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>("/api/users/me"),
  get: (userId: string) => apiFetch<{
    id: string;
    zos_user_id: string | null;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    location: string | null;
    website: string | null;
    profile_id: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>(`/api/users/${userId}`),
  updateMe: (data: { display_name?: string; avatar_url?: string; bio?: string; location?: string; website?: string }) =>
    apiFetch<{
      id: string;
      zos_user_id: string | null;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      location: string | null;
      website: string | null;
      profile_id: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>("/api/users/me", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

export const profilesApi = {
  get: (profileId: string) => apiFetch<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    profile_type: string | null;
    entity_id: string | null;
  }>(`/api/profiles/${profileId}`),
};

export interface FeedEventDto {
  id: string;
  profile_id: string;
  event_type: string;
  post_type?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata: Record<string, unknown> | null;
  org_id?: string | null;
  project_id?: string | null;
  agent_id?: string | null;
  user_id?: string | null;
  push_id?: string | null;
  commit_ids?: string[] | null;
  created_at: string | null;
  comment_count?: number;
  author_name?: string | null;
  author_avatar?: string | null;
}

export interface CommentDto {
  id: string;
  activity_event_id: string;
  profile_id: string;
  content: string;
  created_at: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
}

export const feedApi = {
  list: (filter?: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (filter) params.set("filter", filter);
    if (limit != null) params.set("limit", String(limit));
    if (offset != null) params.set("offset", String(offset));
    const qs = params.toString();
    return apiFetch<FeedEventDto[]>(`/api/feed${qs ? `?${qs}` : ""}`);
  },
  createPost: (data: { title: string; summary?: string; post_type?: string; event_type?: string; metadata?: Record<string, unknown> }) =>
    apiFetch<FeedEventDto>("/api/posts", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getPost: (postId: string) =>
    apiFetch<FeedEventDto>(`/api/posts/${postId}`),
  getProfilePosts: (profileId: string) =>
    apiFetch<FeedEventDto[]>(`/api/profiles/${profileId}/posts`),
  getComments: (postId: string) =>
    apiFetch<CommentDto[]>(`/api/posts/${postId}/comments`),
  addComment: (postId: string, content: string) =>
    apiFetch<CommentDto>(`/api/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  deleteComment: (commentId: string) =>
    apiFetch<void>(`/api/comments/${commentId}`, {
      method: "DELETE",
    }),
};

export const leaderboardApi = {
  get: (period: string, orgId?: string) => {
    const params = new URLSearchParams({ period });
    if (orgId) params.set("org_id", orgId);
    return apiFetch<{
      profile_id: string;
      display_name: string | null;
      avatar_url: string | null;
      tokens_used: number;
      estimated_cost_usd: number;
      event_count: number;
      profile_type: string | null;
    }[]>(`/api/leaderboard?${params}`);
  },
};

export const platformStatsApi = {
  get: () =>
    apiFetch<{
      id: string;
      date: string;
      daily_active_users: number;
      total_users: number;
      new_signups: number;
      projects_created: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_revenue_usd: number;
      created_at: string;
    } | null>("/api/stats"),
};

export const usageApi = {
  personal: (period: string) =>
    apiFetch<{
      total_tokens: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: number;
    }>(`/api/users/me/usage?period=${period}`),
  org: (orgId: string, period: string) =>
    apiFetch<{
      total_tokens: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: number;
    }>(`/api/orgs/${orgId}/usage?period=${period}`),
  orgMembers: (orgId: string) =>
    apiFetch<{
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
      total_tokens: number;
      total_cost_usd: number;
    }[]>(`/api/orgs/${orgId}/usage/members`),
};

export const activityApi = {
  getCommitHistory: (params: {
    user_ids?: string[];
    agent_ids?: string[];
    start_date?: string;
    end_date?: string;
  }) => {
    const qp = new URLSearchParams();
    if (params.user_ids?.length) qp.set("user_ids", params.user_ids.join(","));
    if (params.agent_ids?.length) qp.set("agent_ids", params.agent_ids.join(","));
    if (params.start_date) qp.set("start_date", params.start_date);
    if (params.end_date) qp.set("end_date", params.end_date);
    const qs = qp.toString();
    return apiFetch<DailyCommitActivity[]>(`/api/activity/commits${qs ? `?${qs}` : ""}`);
  },
};
