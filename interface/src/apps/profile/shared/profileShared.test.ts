vi.mock("../../../stores/profile-store", () => ({
  useProfile: vi.fn(),
}));

vi.mock("../../../stores/auth-store", () => ({
  useAuth: vi.fn(),
}));

import { isOwnProfile } from "./profileShared";
import type { UserProfileData } from "../../../stores/profile-store";
import type { ZeroUser } from "../../../shared/types";

function makeUser(overrides: Partial<ZeroUser> = {}): ZeroUser {
  return {
    user_id: "user-1",
    network_user_id: "network-user-1",
    profile_id: "profile-1",
    display_name: "Test User",
    profile_image: "",
    primary_zid: "test-user",
    zero_wallet: "0x0",
    wallets: [],
    ...overrides,
  };
}

function makeProfile(overrides: Partial<UserProfileData> = {}): UserProfileData {
  return {
    id: "profile-1",
    networkUserId: "network-user-1",
    name: "Test User",
    handle: "@test-user",
    bio: "",
    website: "",
    location: "",
    joinedDate: "2026-03-17T01:00:00.000Z",
    ...overrides,
  };
}

describe("isOwnProfile", () => {
  it("prefers explicit profile ids when available", () => {
    expect(isOwnProfile(makeUser(), makeProfile())).toBe(true);
    expect(isOwnProfile(makeUser(), makeProfile({ id: "someone-else" }))).toBe(false);
  });

  it("falls back to explicit network user ids when profile ids are unavailable", () => {
    expect(
      isOwnProfile(
        makeUser({ profile_id: undefined }),
        makeProfile({ id: undefined }),
      ),
    ).toBe(true);

    expect(
      isOwnProfile(
        makeUser({ profile_id: undefined }),
        makeProfile({ id: undefined, networkUserId: "network-user-2" }),
      ),
    ).toBe(false);
  });

  it("falls back to display fields for older profile shapes", () => {
    expect(
      isOwnProfile(
        makeUser({ profile_id: undefined, network_user_id: undefined }),
        makeProfile({ id: undefined, networkUserId: undefined }),
      ),
    ).toBe(true);
  });
});
