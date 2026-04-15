import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PATH, getInitialShellPath } from "./last-app-path";

describe("getInitialShellPath", () => {
  it("restores the last visited app", () => {
    expect(getInitialShellPath("projects")).toBe("/projects");
  });

  it("falls back to the default app when there is no valid last app", () => {
    expect(getInitialShellPath(null)).toBe(DEFAULT_APP_PATH);
    expect(getInitialShellPath("unknown")).toBe(DEFAULT_APP_PATH);
  });
});
