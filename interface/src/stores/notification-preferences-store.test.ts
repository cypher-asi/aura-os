import { beforeEach, describe, expect, it } from "vitest";
import { NotificationKind } from "../shared/types/notifications";
import { useNotificationPreferencesStore } from "./notification-preferences-store";

describe("useNotificationPreferencesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationPreferencesStore.getState().reset();
  });

  it("defaults desktop and in-app notifications on", () => {
    const { preferences } = useNotificationPreferencesStore.getState();

    expect(preferences.enabled).toBe(true);
    expect(preferences.desktopEnabled).toBe(true);
    expect(preferences.inAppEnabled).toBe(true);
    expect(preferences.browserEnabled).toBe(false);
  });

  it("persists notification type toggles", () => {
    useNotificationPreferencesStore
      .getState()
      .setTypeEnabled(NotificationKind.TaskCompleted, false);

    expect(
      useNotificationPreferencesStore.getState().preferences.types[
        NotificationKind.TaskCompleted
      ],
    ).toBe(false);

    const stored = JSON.parse(
      localStorage.getItem("aura-notification-preferences-v1") ?? "{}",
    );
    expect(stored.types.task_completed).toBe(false);
  });
});
