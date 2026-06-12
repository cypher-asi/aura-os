import { act, renderHook } from "@testing-library/react";
import {
  GOOGLE_OAUTH_POPUP_TIMEOUT_MS,
  useIntegrationsManager,
} from "./use-integrations-manager";
import { useAuthStore } from "../stores/auth-store";
import { useOrgStore } from "../stores/org-store";

const mocks = vi.hoisted(() => ({
  createIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  list: vi.fn(),
  listIntegrations: vi.fn(),
  listMembers: vi.fn(),
  startGoogleOAuth: vi.fn(),
  updateIntegration: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    orgs: {
      createIntegration: mocks.createIntegration,
      deleteIntegration: mocks.deleteIntegration,
      list: mocks.list,
      listIntegrations: mocks.listIntegrations,
      listMembers: mocks.listMembers,
      startGoogleOAuth: mocks.startGoogleOAuth,
      updateIntegration: mocks.updateIntegration,
    },
  },
}));

const activeOrg = {
  org_id: "org-1",
  name: "Test Org",
  owner_user_id: "user-1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("useIntegrationsManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.listIntegrations.mockResolvedValue([]);
    mocks.listMembers.mockResolvedValue([]);
    // Setting the auth user triggers the org-store boot subscriber, which
    // hydrates and then calls `refreshOrgs()`. That refresh replaces
    // `activeOrg` with whatever `api.orgs.list()` returns, so the list must
    // contain the test org or `activeOrg` is reset to null before the hook
    // under test runs (making `connectGoogle` bail out early).
    mocks.list.mockResolvedValue([activeOrg]);
    mocks.startGoogleOAuth.mockResolvedValue({
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
    });

    useAuthStore.setState({
      user: {
        user_id: "user-1",
        network_user_id: "user-1",
        profile_id: "profile-1",
        display_name: "Test User",
        profile_image: null,
        primary_zid: null,
        zero_wallet: null,
        wallets: [],
        is_zero_pro: true,
        is_access_granted: true,
        is_sys_admin: false,
      },
      isLoading: false,
      hasResolvedInitialSession: true,
      zeroProRefreshError: null,
    });

    useOrgStore.setState({
      activeOrg,
      members: [],
      integrations: [],
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recovers when the Google OAuth popup never completes or closes", async () => {
    const popup = { closed: false } as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
    const { result } = renderHook(() => useIntegrationsManager());

    let connectPromise: Promise<boolean | null> | null = null;
    await act(async () => {
      connectPromise = result.current.connectGoogle();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledOnce();
    expect(result.current.busyId).toBe("google_oauth");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_POPUP_TIMEOUT_MS);
      await connectPromise;
    });

    expect(result.current.busyId).toBeNull();
    expect(mocks.listIntegrations).toHaveBeenCalled();
  });
});
