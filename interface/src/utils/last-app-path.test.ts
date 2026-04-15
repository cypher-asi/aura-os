import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_PATH,
  getInitialShellPath,
  isValidRestorePath,
  sanitizeRestorePath,
} from "./last-app-path";

describe("getInitialShellPath", () => {
  it("prefers the last visited in-app route when available", () => {
    expect(getInitialShellPath("projects", "/projects/project-123/agents/agent-456?session=abc")).toBe(
      "/projects/project-123/agents/agent-456?session=abc",
    );
  });

  it("restores the last visited app", () => {
    expect(getInitialShellPath("projects")).toBe("/projects");
  });

  it("falls back to the default app when there is no valid last app", () => {
    expect(getInitialShellPath(null)).toBe(DEFAULT_APP_PATH);
    expect(getInitialShellPath("unknown")).toBe(DEFAULT_APP_PATH);
  });
});

describe("isValidRestorePath", () => {
  it("rejects root, desktop, and login routes", () => {
    expect(isValidRestorePath("/")).toBe(false);
    expect(isValidRestorePath("/desktop")).toBe(false);
    expect(isValidRestorePath("/desktop?panel=1")).toBe(false);
    expect(isValidRestorePath("/login")).toBe(false);
    expect(isValidRestorePath("/login?next=/projects")).toBe(false);
    expect(isValidRestorePath("/api/runtime-config")).toBe(false);
    expect(isValidRestorePath("/ws")).toBe(false);
  });

  it("accepts deep shell routes including query strings", () => {
    expect(isValidRestorePath("/projects/project-123/agents/agent-456?session=abc")).toBe(true);
    expect(isValidRestorePath("/agents/agent-123")).toBe(true);
  });
});

describe("sanitizeRestorePath", () => {
  it("strips desktop bootstrap query params from restore paths", () => {
    expect(sanitizeRestorePath("/projects/demo?session=abc&host=http://127.0.0.1:19847#panel")).toBe(
      "/projects/demo?session=abc#panel",
    );
  });

  it("returns null for invalid restore targets", () => {
    expect(sanitizeRestorePath("/desktop?host=http://127.0.0.1:19847")).toBeNull();
  });
});
