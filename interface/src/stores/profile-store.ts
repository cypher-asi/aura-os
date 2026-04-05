import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { FeedEvent } from "./feed-store";
import { networkEventToFeedEvent } from "./feed-store";
import type { FeedComment } from "./shared/event-comments-slice";
import type { EventCommentsSlice } from "./shared/event-comments-slice";
import {
  createEventCommentsSlice,
  setupCommentLoadingSubscription,
} from "./shared/event-comments-slice";
import { useAuthStore } from "./auth-store";
import { useOrgStore } from "./org-store";
import { api } from "../api/client";

export interface UserProfileData {
  id?: string;
  networkUserId?: string;
  name: string;
  handle: string;
  bio: string;
  website: string;
  location: string;
  joinedDate: string;
  avatarUrl?: string;
}

export interface ProfileProject {
  id: string;
  name: string;
  repo: string;
}

interface ProfileState extends EventCommentsSlice {
  profile: UserProfileData;
  projects: ProfileProject[];
  projectsStatus: "idle" | "loading" | "ready" | "error";
  liveEvents: FeedEvent[];
  eventsStatus: "idle" | "loading" | "ready" | "error";
  totalTokenUsage: number;
  selectedProject: string | null;

  updateProfile: (data: Partial<UserProfileData>) => void;
  setSelectedProject: (id: string | null) => void;
  init: () => void;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function commitActivityFromEvents(events: FeedEvent[]): Record<string, number> {
  const activity: Record<string, number> = {};
  for (const evt of events) {
    if (evt.postType !== "push") continue;
    const ts = new Date(evt.timestamp);
    const dateKey = evt.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    activity[hourKey] = (activity[hourKey] ?? 0) + evt.commits.length;
  }
  return activity;
}

function repoActivityForProject(events: FeedEvent[], repo: string): Record<string, number> {
  const activity: Record<string, number> = {};
  for (const evt of events) {
    if (evt.postType !== "push" || evt.repo !== repo) continue;
    const ts = new Date(evt.timestamp);
    const dateKey = evt.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    activity[hourKey] = (activity[hourKey] ?? 0) + evt.commits.length;
  }
  return activity;
}

export function buildProfileEvents(
  liveEvents: FeedEvent[],
  profileName: string,
  profileAvatarUrl?: string,
): FeedEvent[] {
  return [...liveEvents]
    .map((evt) => {
      if (profileAvatarUrl && evt.author.type === "user") {
        return { ...evt, author: { ...evt.author, name: profileName || evt.author.name, avatarUrl: profileAvatarUrl } };
      }
      return evt;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function buildFilteredProfileEvents(
  events: FeedEvent[],
  projects: ProfileProject[],
  selectedProject: string | null,
): FeedEvent[] {
  if (!selectedProject) return events;
  const project = projects.find((item) => item.id === selectedProject);
  if (!project) return events;
  return events.filter((event) => event.repo === project.repo);
}

export function buildProfileCommitActivity(
  events: FeedEvent[],
  projects: ProfileProject[],
  selectedProject: string | null,
): Record<string, number> {
  if (!selectedProject) return commitActivityFromEvents(events);
  const project = projects.find((item) => item.id === selectedProject);
  if (!project) return commitActivityFromEvents(events);
  return repoActivityForProject(events, project.repo);
}

export function getProfileCommentsForEvent(comments: FeedComment[], eventId: string): FeedComment[] {
  return comments
    .filter((comment) => comment.eventId === eventId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

let _initialized = false;

type ProfileSetter = (
  partial: ProfileState | Partial<ProfileState> | ((state: ProfileState) => ProfileState | Partial<ProfileState>),
) => void;

function loadProfileFromNetwork(
  set: ProfileSetter,
  user: ReturnType<typeof useAuthStore.getState>["user"],
): void {
  set({ eventsStatus: "loading" });
  api.users
    .me()
    .then((networkUser) => {
      const networkName =
        networkUser.display_name && !isUuid(networkUser.display_name)
          ? networkUser.display_name
          : undefined;

      set((s) => ({
        profile: {
          ...s.profile,
          id: networkUser.profile_id ?? s.profile.id,
          networkUserId: networkUser.id ?? s.profile.networkUserId,
          name: networkName ?? user?.display_name ?? s.profile.name,
          bio: networkUser.bio ?? s.profile.bio,
          location: networkUser.location ?? s.profile.location,
          website: networkUser.website ?? s.profile.website,
          avatarUrl: networkUser.avatar_url ?? s.profile.avatarUrl,
          joinedDate: networkUser.created_at ?? s.profile.joinedDate,
        },
      }));

      if (networkUser.profile_id) {
        api.feed.getProfilePosts(networkUser.profile_id)
          .then((netEvents) => set({
            liveEvents: netEvents.map(networkEventToFeedEvent),
            eventsStatus: "ready",
          }))
          .catch(() => set({ eventsStatus: "error" }));
      } else {
        set({ eventsStatus: "ready" });
      }
    })
    .catch(() => set({ eventsStatus: "error" }));
}

function loadProfileProjects(set: ProfileSetter, orgId?: string | null): void {
  set({ projectsStatus: "loading" });
  api.listProjects(orgId ?? undefined)
    .then((apiProjects) => {
      set({
        projects: apiProjects.map((p) => {
          const repo = p.orbit_owner && p.orbit_repo
            ? `${p.orbit_owner}/${p.orbit_repo}`
            : (p.git_repo_url ?? "");
          return { id: p.project_id, name: p.name, repo };
        }),
        projectsStatus: "ready",
      });
    })
    .catch(() => set({ projectsStatus: "error" }));
}

export const useProfileStore = create<ProfileState>()((set, get) => {
  const user = useAuthStore.getState().user;
  const zid = user?.primary_zid || "";

  const eventComments = createEventCommentsSlice<ProfileState>(set, {
    idPrefix: "p-cmt",
    getAuthorInfo: () => {
      const u = useAuthStore.getState().user;
      const { profile } = get();
      return { name: u?.display_name || "You", avatarUrl: profile.avatarUrl };
    },
  });

  return {
    ...eventComments,

    profile: {
      name: user?.display_name || "",
      bio: "",
      website: "",
      location: "",
      joinedDate: new Date().toISOString(),
      id: user?.profile_id,
      networkUserId: user?.network_user_id,
      avatarUrl: user?.profile_image || undefined,
      handle: zid ? `@${zid}` : "",
    },
    projects: [],
    projectsStatus: "idle",
    liveEvents: [],
    eventsStatus: "idle",
    totalTokenUsage: 0,
    selectedProject: null,

    updateProfile: (data) => {
      set((s) => ({ profile: { ...s.profile, ...data } }));

      const networkFields: Record<string, string | undefined> = {};
      if (data.name !== undefined) networkFields.display_name = data.name;
      if (data.bio !== undefined) networkFields.bio = data.bio;
      if (data.avatarUrl !== undefined) networkFields.avatar_url = data.avatarUrl;
      if (data.location !== undefined) networkFields.location = data.location;
      if (data.website !== undefined) networkFields.website = data.website;
      if (Object.keys(networkFields).length > 0) {
        api.users.updateMe(networkFields).catch(() => {});
      }
    },

    setSelectedProject: (id) => {
      set({ selectedProject: id, selectedEventId: null });
    },

    init: () => {
      if (_initialized) return;
      _initialized = true;

      const user = useAuthStore.getState().user;
      const zid = user?.primary_zid || "";
      if (zid) {
        set((s) => ({ profile: { ...s.profile, handle: `@${zid}` } }));
      }

      loadProfileFromNetwork(set, user);
      loadProfileProjects(set, useOrgStore.getState().activeOrg?.org_id);
      api.usage.personal("all")
        .then((stats) => set({ totalTokenUsage: stats.total_tokens }))
        .catch(() => {});
    },
  };
});

setupCommentLoadingSubscription(useProfileStore.subscribe, useProfileStore.setState);

let _prevProfileOrgId: string | null = null;
useOrgStore.subscribe((state) => {
  if (!_initialized) return;
  const orgId = state.activeOrg?.org_id ?? null;
  if (orgId === _prevProfileOrgId) return;
  _prevProfileOrgId = orgId;
  loadProfileProjects(useProfileStore.setState, orgId);
});

/* ── derived selectors ── */

export function useProfileEvents(): FeedEvent[] {
  const liveEvents = useProfileStore((s) => s.liveEvents);
  const profileName = useProfileStore((s) => s.profile.name);
  const profileAvatarUrl = useProfileStore((s) => s.profile.avatarUrl);

  return useMemo(
    () => buildProfileEvents(liveEvents, profileName, profileAvatarUrl),
    [liveEvents, profileAvatarUrl, profileName],
  );
}

export function useProfileFilteredEvents(): FeedEvent[] {
  const events = useProfileEvents();
  const selectedProject = useProfileStore((s) => s.selectedProject);
  const projects = useProfileStore((s) => s.projects);

  return useMemo(
    () => buildFilteredProfileEvents(events, projects, selectedProject),
    [events, projects, selectedProject],
  );
}

export function useProfileCommitActivity(): Record<string, number> {
  const events = useProfileEvents();
  const selectedProject = useProfileStore((s) => s.selectedProject);
  const projects = useProfileStore((s) => s.projects);

  return useMemo(
    () => buildProfileCommitActivity(events, projects, selectedProject),
    [events, projects, selectedProject],
  );
}

export function useProfileCommentsForEvent(eventId: string | null): FeedComment[] {
  const comments = useProfileStore((s) => s.comments);
  return useMemo(
    () => (eventId ? getProfileCommentsForEvent(comments, eventId) : []),
    [comments, eventId],
  );
}

/**
 * Drop-in replacement for the old useProfile() context hook.
 * Includes derived values so consumers need only an import-path change.
 */
export function useProfile() {
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const projects = useProfileStore((s) => s.projects);
  const totalTokenUsage = useProfileStore((s) => s.totalTokenUsage);
  const selectedProject = useProfileStore((s) => s.selectedProject);
  const setSelectedProject = useProfileStore((s) => s.setSelectedProject);
  const selectedEventId = useProfileStore((s) => s.selectedEventId);
  const selectEvent = useProfileStore((s) => s.selectEvent);
  const addComment = useProfileStore((s) => s.addComment);
  const comments = useProfileStore((s) => s.comments);

  const events = useProfileEvents();
  const filteredEvents = useProfileFilteredEvents();
  const commitActivity = useProfileCommitActivity();

  const getCommentsForEvent = useCallback(
    (eventId: string) => getProfileCommentsForEvent(comments, eventId),
    [comments],
  );

  return {
    profile,
    updateProfile,
    projects,
    events,
    filteredEvents,
    commitActivity,
    totalTokenUsage,
    selectedProject,
    setSelectedProject,
    selectedEventId,
    selectEvent,
    getCommentsForEvent,
    addComment,
  };
}
