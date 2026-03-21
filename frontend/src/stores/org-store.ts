import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Org, OrgMember } from "../types";
import { api } from "../api/client";
import { useAuthStore } from "./auth-store";
import { ACTIVE_ORG_KEY } from "../constants";

interface OrgState {
  orgs: Org[];
  activeOrg: Org | null;
  members: OrgMember[];
  isLoading: boolean;
  switchOrg: (orgId: string) => void;
  refreshOrgs: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  createOrg: (name: string) => Promise<Org>;
  renameOrg: (orgId: string, name: string) => Promise<void>;
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  orgs: [],
  activeOrg: null,
  members: [],
  isLoading: true,

  refreshOrgs: async () => {
    const user = useAuthStore.getState().user;
    if (!user) {
      set({ isLoading: false });
      return;
    }
    try {
      const list = await api.orgs.list();
      const savedId = localStorage.getItem(ACTIVE_ORG_KEY);
      const match = list.find((o) => o.org_id === savedId);
      const selected = match ?? list[0] ?? null;
      set({ orgs: list, activeOrg: selected });
      if (selected) {
        localStorage.setItem(ACTIVE_ORG_KEY, selected.org_id);
      }
    } catch (err) {
      console.error("Failed to load orgs", err);
    } finally {
      set({ isLoading: false });
    }
  },

  refreshMembers: async () => {
    const { activeOrg } = get();
    if (!activeOrg) {
      set({ members: [] });
      return;
    }
    try {
      const m = await api.orgs.listMembers(activeOrg.org_id);
      set({ members: m });
    } catch (err) {
      console.error("Failed to load members", err);
    }
  },

  switchOrg: (orgId: string) => {
    const { orgs } = get();
    const org = orgs.find((o) => o.org_id === orgId);
    if (org) {
      set({ activeOrg: org });
      localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    }
  },

  createOrg: async (name: string) => {
    const org = await api.orgs.create(name);
    await get().refreshOrgs();
    return org;
  },

  renameOrg: async (orgId: string, name: string) => {
    const updated = await api.orgs.update(orgId, name);
    set((state) => ({
      orgs: state.orgs.map((o) => (o.org_id === orgId ? updated : o)),
      activeOrg: state.activeOrg?.org_id === orgId ? updated : state.activeOrg,
    }));
  },
}));

// Auto-refresh orgs when authenticated user changes
let _prevUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const userId = state.user?.user_id ?? null;
  if (userId === _prevUserId) return;
  _prevUserId = userId;
  if (userId) {
    useOrgStore.getState().refreshOrgs();
  } else {
    useOrgStore.setState({ orgs: [], activeOrg: null, members: [], isLoading: false });
  }
});

// Auto-refresh members when active org changes
let _prevActiveOrgId: string | null = null;
useOrgStore.subscribe((state) => {
  const orgId = state.activeOrg?.org_id ?? null;
  if (orgId === _prevActiveOrgId) return;
  _prevActiveOrgId = orgId;
  state.refreshMembers();
});

/**
 * Drop-in replacement for the old useOrg() context hook.
 * Prefer useOrgStore(selector) for fine-grained subscriptions.
 */
export function useOrg() {
  return useOrgStore(
    useShallow((s) => ({
      orgs: s.orgs,
      activeOrg: s.activeOrg,
      members: s.members,
      isLoading: s.isLoading,
      switchOrg: s.switchOrg,
      refreshOrgs: s.refreshOrgs,
      refreshMembers: s.refreshMembers,
      createOrg: s.createOrg,
      renameOrg: s.renameOrg,
    })),
  );
}
