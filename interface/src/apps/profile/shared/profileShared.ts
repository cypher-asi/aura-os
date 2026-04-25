import { useState } from "react";
import type { FeedEvent } from "../../../stores/feed-store";
import type { UserProfileData } from "../../../stores/profile-store";
import { useProfile } from "../../../stores/profile-store";
import { useAuth } from "../../../stores/auth-store";
import type { ZeroUser } from "../../../shared/types";

export interface ProfileSummaryModel {
  profile: UserProfileData;
  updateProfile: (data: Partial<UserProfileData>) => void;
  isOwnProfile: boolean;
  totalCommits: number;
  projectCount: number;
  totalTokenUsage: number;
  followTargetId?: string;
  editorOpen: boolean;
  openEditor: () => void;
  closeEditor: () => void;
  logout: () => void;
}

export function formatJoinedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function isOwnProfile(user: ZeroUser | null, profile: UserProfileData): boolean {
  if (!user) return false;
  if (user.profile_id && profile.id) return user.profile_id === profile.id;
  if (user.network_user_id && profile.networkUserId) {
    return user.network_user_id === profile.networkUserId;
  }
  return (
    user.display_name === profile.name ||
    profile.handle === `@${user.primary_zid}`
  );
}

export function countProfileCommits(events: FeedEvent[]): number {
  return events
    .filter((event) => event.postType === "push")
    .reduce((sum, event) => sum + event.commits.length, 0);
}

export function getProfileEventDetail(event: FeedEvent): string {
  if (event.postType === "push" && event.repo) {
    const repoName = event.repo.split("/").pop() || event.repo;
    return `${repoName}/${event.branch}`;
  }
  return event.title || event.postType;
}

export function useProfileSummaryModel(): ProfileSummaryModel {
  const { profile, updateProfile, events, projects, totalTokenUsage } = useProfile();
  const { user, logout } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);

  return {
    profile,
    updateProfile,
    isOwnProfile: isOwnProfile(user, profile),
    totalCommits: countProfileCommits(events),
    projectCount: projects.length,
    totalTokenUsage,
    followTargetId: profile.id,
    editorOpen,
    openEditor: () => setEditorOpen(true),
    closeEditor: () => setEditorOpen(false),
    logout: () => { void logout(); },
  };
}
