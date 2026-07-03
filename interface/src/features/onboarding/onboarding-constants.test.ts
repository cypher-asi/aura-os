import { describe, expect, it } from "vitest";
import { getOnboardingTasks } from "./onboarding-constants";

describe("getOnboardingTasks", () => {
  it("puts chat first for chat intent", () => {
    const tasks = getOnboardingTasks("chat", "web");

    expect(tasks.map((task) => task.id).slice(0, 2)).toEqual([
      "send_message",
      "create_project",
    ]);
    expect(tasks[0].route).toBe("/chat");
  });

  it("puts build first for build intent", () => {
    const tasks = getOnboardingTasks("build", "desktop");

    expect(tasks.map((task) => task.id).slice(0, 2)).toEqual([
      "create_project",
      "send_message",
    ]);
  });

  it("uses runtime-aware ordering when the user skipped intent selection", () => {
    expect(getOnboardingTasks(null, "web")[0]?.id).toBe("send_message");
    expect(getOnboardingTasks(null, "desktop")[0]?.id).toBe("create_project");
  });

  it("describes build differently on web and desktop", () => {
    const webBuild = getOnboardingTasks("build", "web").find((task) => task.id === "create_project");
    const desktopBuild = getOnboardingTasks("build", "desktop").find((task) => task.id === "create_project");

    expect(webBuild?.description).toContain("remote agents");
    expect(desktopBuild?.description).toContain("local agents");
  });
});
