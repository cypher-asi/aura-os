import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PATH, getInitialShellPath } from "./last-app-path";

describe("getInitialShellPath", () => {
  it("pins desktop-capable launches to the desktop workspace", () => {
    expect(getInitialShellPath("agents", true)).toBe("/desktop");
  });

  it("restores the last visited app on web launches", () => {
    expect(getInitialShellPath("projects", false)).toBe("/projects");
  });

  it("falls back to the default app when there is no valid last app", () => {
    expect(getInitialShellPath(null, false)).toBe(DEFAULT_APP_PATH);
    expect(getInitialShellPath("unknown", false)).toBe(DEFAULT_APP_PATH);
  });
});
