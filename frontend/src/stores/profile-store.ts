import { useCallback } from "react";
import { create } from "zustand";
import type { FeedEvent, FeedComment } from "./feed-store";
import { networkEventToFeedEvent, networkCommentToFeedComment } from "./feed-store";
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

interface ProfileState {
  profile: UserProfileData;
  projects: ProfileProject[];
  liveEvents: FeedEvent[];
  totalTokenUsage: number;
  selectedProject: string | null;
  selectedEventId: string | null;
  comments: FeedComment[];

  updateProfile: (data: Partial<UserProfileData>) => void;
  setSelectedProject: (id: string | null) => void;
  selectEvent: (id: string | null) => void;
  addComment: (eventId: string, text: string) => void;
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

let _initialized = false;
let _nextCommentId = 1;
const _loadedCommentIds = new Set<string>();

type ProfileSetter = (
  partial: ProfileState | Partial<ProfileState> | ((state: ProfileState) => ProfileState | Partial<ProfileState>),
) => void;

function loadProfileFromNetwork(
  set: ProfileSetter,
  user: ReturnType<typeof useAuthStore.getState>["user"],
): void {
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
          .then((netEvents) => set({ liveEvents: netEvents.map(networkEventToFeedEvent) }))
          .catch(() => {});
      }
    })
    .catch(() => {});
}

function loadProfileProjects(set: ProfileSetter, orgId?: string | null): void {
  api.listProjects(orgId ?? undefined)
    .then((apiProjects) => {
      set({
        projects: apiProjects.map((p) => {
          const repo = p.orbit_owner && p.orbit_repo
            ? `${p.orbit_owner}/${p.orbit_repo}`
            : (p.git_repo_url ?? "");
          return { id: p.project_id, name: p.name, repo };
        }),
      });
    })
    .catch(() => {});
}

export const useProfileStore = create<ProfileState>()((set, get) => {
  const user = useAuthStore.getState().user;
  const zid = user?.primary_zid || "";

  return {
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
    liveEvents: [],
    totalTokenUsage: 0,
    selectedProject: null,
    selectedEventId: null,
    comments: [],

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

    selectEvent: (id) => set({ selectedEventId: id }),

    addComment: (eventId, text) => {
      const user = useAuthStore.getState().user;
      const { profile } = get();
      const authorName = user?.display_name || "You";
      const makeLocal = (): FeedComment => ({
        id: `p-cmt-${_nextCommentId++}`,
        eventId,
        author: { name: authorName, type: "user", avatarUrl: profile.avatarUrl },
        text,
        timestamp: new Date().toISOString(),
      });

      api.feed
        .addComment(eventId, text)
        .then((net) => {
          set((s) => ({ comments: [...s.comments, networkCommentToFeedComment(net)] }));
        })
        .catch(() => {
          set((s) => ({ comments: [...s.comments, makeLocal()] }));
        });
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

/** Load comments for the selected event (idempotent per eventId). */
useProfileStore.subscribe((state, prev) => {
  const eventId = state.selectedEventId;
  if (!eventId || eventId === prev.selectedEventId) return;
  if (_loadedCommentIds.has(eventId)) return;
  _loadedCommentIds.add(eventId);

  api.feed
    .getComments(eventId)
    .then((netComments) => {
      const mapped = netComments.map(networkCommentToFeedComment);
      if (mapped.length > 0) {
        useProfileStore.setState((s) => {
          const existingIds = new Set(s.comments.map((c) => c.id));
          const fresh = mapped.filter((c) => !existingIds.has(c.id));
          return fresh.length > 0 ? { comments: [...s.comments, ...fresh] } : {};
        });
      }
    })
    .catch(() => {});
});

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

  const events = [...liveEvents]
    .map((evt) => {
      if (profileAvatarUrl && evt.author.type === "user") {
        return { ...evt, author: { ...evt.author, name: profileName || evt.author.name, avatarUrl: profileAvatarUrl } };
      }
      return evt;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events;
}

export function useProfileFilteredEvents(): FeedEvent[] {
  const events = useProfileEvents();
  const selectedProject = useProfileStore((s) => s.selectedProject);
  const projects = useProfileStore((s) => s.projects);

  if (!selectedProject) return events;
  const project = projects.find((p) => p.id === selectedProject);
  if (!project) return events;
  return events.filter((e) => e.repo === project.repo);
}

export function useProfileCommitActivity(): Record<string, number> {
  const events = useProfileEvents();
  const selectedProject = useProfileStore((s) => s.selectedProject);
  const projects = useProfileStore((s) => s.projects);

  if (!selectedProject) return commitActivityFromEvents(events);
  const project = projects.find((p) => p.id === selectedProject);
  if (!project) return commitActivityFromEvents(events);
  return repoActivityForProject(events, project.repo);
}

export function useProfileCommentsForEvent(eventId: string | null): FeedComment[] {
  const comments = useProfileStore((s) => s.comments);
  if (!eventId) return [];
  return comments
    .filter((c) => c.eventId === eventId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
    (eventId: string) =>
      comments
        .filter((c) => c.eventId === eventId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
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
