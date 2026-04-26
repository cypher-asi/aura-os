import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Org, OrgMember, OrgIntegration } from "../shared/types";

const org1: Org = {
  org_id: "org-1",
  name: "Test Org",
  owner_user_id: "u1",
  billing: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const org2: Org = {
  org_id: "org-2",
  name: "Other Org",
  owner_user_id: "u1",
  billing: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const member1: OrgMember = {
  org_id: "org-1",
  user_id: "u1",
  display_name: "User One",
  role: "owner",
  joined_at: "2025-01-01T00:00:00Z",
};

const integration1: OrgIntegration = {
  integration_id: "int-1",
  org_id: "org-1",
  name: "Anthropic Team",
  provider: "anthropic",
  kind: "workspace_connection",
  default_model: null,
  provider_config: null,
  has_secret: true,
  enabled: true,
  secret_last4: "1234",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const { mockApi, mockLocalStorage } = vi.hoisted(() => {
  const mockLocalStorage: Record<string, string> = {};
  return {
    mockApi: {
      orgs: {
        list: vi.fn(),
        listMembers: vi.fn(),
        listIntegrations: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
    mockLocalStorage,
  };
});

vi.mock("../api/client", () => ({ api: mockApi }));

vi.mock("./auth-store", () => ({
  useAuthStore: {
    getState: () => ({ user: { user_id: "u1" } }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockLocalStorage[key] = val; },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
});

import { useOrgStore } from "./org-store";

beforeEach(() => {
  useOrgStore.setState({
    orgs: [],
    activeOrg: null,
    members: [],
    integrations: [],
    isLoading: true,
    orgsError: null,
    membersError: null,
    integrationsError: null,
  });
  for (const key of Object.keys(mockLocalStorage)) delete mockLocalStorage[key];
  vi.clearAllMocks();
  mockApi.orgs.listMembers.mockResolvedValue([]);
  mockApi.orgs.listIntegrations.mockResolvedValue([]);
});

describe("org-store", () => {
  describe("initial state", () => {
    it("has no orgs", () => {
      expect(useOrgStore.getState().orgs).toEqual([]);
    });

    it("has no activeOrg", () => {
      expect(useOrgStore.getState().activeOrg).toBeNull();
    });

    it("has no members", () => {
      expect(useOrgStore.getState().members).toEqual([]);
    });

    it("starts loading", () => {
      expect(useOrgStore.getState().isLoading).toBe(true);
    });

    it("starts without load errors", () => {
      expect(useOrgStore.getState().orgsError).toBeNull();
      expect(useOrgStore.getState().membersError).toBeNull();
      expect(useOrgStore.getState().integrationsError).toBeNull();
    });
  });

  describe("refreshOrgs", () => {
    it("loads orgs and selects the first one", async () => {
      mockApi.orgs.list.mockResolvedValue([org1, org2]);

      await useOrgStore.getState().refreshOrgs();

      expect(useOrgStore.getState().orgs).toEqual([org1, org2]);
      expect(useOrgStore.getState().activeOrg).toEqual(org1);
      expect(useOrgStore.getState().isLoading).toBe(false);
    });

    it("restores savedId from localStorage", async () => {
      mockLocalStorage["aura-active-org"] = "org-2";
      mockApi.orgs.list.mockResolvedValue([org1, org2]);

      await useOrgStore.getState().refreshOrgs();

      expect(useOrgStore.getState().activeOrg).toEqual(org2);
    });

    it("clears stale members and integrations when the selected org changes", async () => {
      mockLocalStorage["aura-active-org"] = "org-2";
      mockApi.orgs.list.mockResolvedValue([org1, org2]);
      useOrgStore.setState({
        orgs: [org1, org2],
        activeOrg: org1,
        members: [member1],
        integrations: [integration1],
        isLoading: false,
      });

      await useOrgStore.getState().refreshOrgs();

      expect(useOrgStore.getState().activeOrg).toEqual(org2);
      expect(useOrgStore.getState().members).toEqual([]);
      expect(useOrgStore.getState().integrations).toEqual([]);
    });

    it("handles API failure gracefully", async () => {
      mockApi.orgs.list.mockRejectedValue(new Error("fail"));

      await useOrgStore.getState().refreshOrgs();

      expect(useOrgStore.getState().isLoading).toBe(false);
      expect(useOrgStore.getState().orgsError).toBe("fail");
    });
  });

  describe("refreshMembers", () => {
    it("loads members for activeOrg", async () => {
      useOrgStore.setState({ activeOrg: org1 });
      mockApi.orgs.listMembers.mockResolvedValue([member1]);

      await useOrgStore.getState().refreshMembers();

      expect(useOrgStore.getState().members).toEqual([member1]);
    });

    it("clears members when no activeOrg", async () => {
      useOrgStore.setState({ activeOrg: null, members: [member1] });

      await useOrgStore.getState().refreshMembers();

      expect(useOrgStore.getState().members).toEqual([]);
    });
  });

  describe("switchOrg", () => {
    it("switches activeOrg and persists to localStorage", () => {
      useOrgStore.setState({ orgs: [org1, org2] });
      useOrgStore.getState().switchOrg("org-2");

      expect(useOrgStore.getState().activeOrg).toEqual(org2);
      expect(mockLocalStorage["aura-active-org"]).toBe("org-2");
    });

    it("clears stale members and integrations when switching orgs", () => {
      useOrgStore.setState({
        orgs: [org1, org2],
        activeOrg: org1,
        members: [member1],
        integrations: [integration1],
      });

      useOrgStore.getState().switchOrg("org-2");

      expect(useOrgStore.getState().activeOrg).toEqual(org2);
      expect(useOrgStore.getState().members).toEqual([]);
      expect(useOrgStore.getState().integrations).toEqual([]);
    });

    it("does nothing if orgId not found", () => {
      useOrgStore.setState({ orgs: [org1], activeOrg: org1 });
      useOrgStore.getState().switchOrg("nonexistent");

      expect(useOrgStore.getState().activeOrg).toEqual(org1);
    });

    it("switches activeOrg when given a concrete org object", () => {
      useOrgStore.setState({ orgs: [org1], activeOrg: org1 });

      useOrgStore.getState().switchOrg(org2);

      expect(useOrgStore.getState().activeOrg).toEqual(org2);
      expect(mockLocalStorage["aura-active-org"]).toBe("org-2");
    });
  });

  describe("renameOrg", () => {
    it("updates the org name in orgs list and activeOrg", async () => {
      const renamed = { ...org1, name: "Renamed" };
      mockApi.orgs.update.mockResolvedValue(renamed);
      useOrgStore.setState({ orgs: [org1, org2], activeOrg: org1 });

      await useOrgStore.getState().renameOrg("org-1", "Renamed");

      expect(mockApi.orgs.update).toHaveBeenCalledWith("org-1", { name: "Renamed" });
      expect(useOrgStore.getState().orgs[0].name).toBe("Renamed");
      expect(useOrgStore.getState().activeOrg?.name).toBe("Renamed");
    });

    it("does not update activeOrg if different org is renamed", async () => {
      const renamed = { ...org2, name: "Renamed" };
      mockApi.orgs.update.mockResolvedValue(renamed);
      useOrgStore.setState({ orgs: [org1, org2], activeOrg: org1 });

      await useOrgStore.getState().renameOrg("org-2", "Renamed");

      expect(mockApi.orgs.update).toHaveBeenCalledWith("org-2", { name: "Renamed" });
      expect(useOrgStore.getState().activeOrg?.name).toBe("Test Org");
      expect(useOrgStore.getState().orgs[1].name).toBe("Renamed");
    });
  });

  describe("updateOrgAvatar", () => {
    it("updates the org avatar in orgs list and activeOrg", async () => {
      const updated = { ...org1, avatar_url: "data:image/png;base64,abc" };
      mockApi.orgs.update.mockResolvedValue(updated);
      useOrgStore.setState({ orgs: [org1, org2], activeOrg: org1 });

      await useOrgStore.getState().updateOrgAvatar("org-1", updated.avatar_url);

      expect(mockApi.orgs.update).toHaveBeenCalledWith("org-1", {
        avatar_url: updated.avatar_url,
      });
      expect(useOrgStore.getState().orgs[0].avatar_url).toBe(updated.avatar_url);
      expect(useOrgStore.getState().activeOrg?.avatar_url).toBe(updated.avatar_url);
    });

    it("clears the org avatar", async () => {
      const orgWithAvatar = { ...org1, avatar_url: "data:image/png;base64,abc" };
      const updated = { ...org1, avatar_url: undefined };
      mockApi.orgs.update.mockResolvedValue(updated);
      useOrgStore.setState({ orgs: [orgWithAvatar, org2], activeOrg: orgWithAvatar });

      await useOrgStore.getState().updateOrgAvatar("org-1", null);

      expect(mockApi.orgs.update).toHaveBeenCalledWith("org-1", { avatar_url: null });
      expect(useOrgStore.getState().activeOrg?.avatar_url).toBeUndefined();
    });
  });
});
