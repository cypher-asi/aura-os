import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearViewedFiles, diffFingerprint, readViewedFiles, revalidateViewedFiles, viewedFileKey, viewedFilesIdentity, writeViewedFiles } from "./source-control-viewed-files";
import type { SourceControlDiff } from "../api/source-control";

const diff: SourceControlDiff = { path: "app.ts", area: "worktree", diff: "-old\n+new", binary: false, truncated: false };
const identity = vi.hoisted(() => ({ user: "user-a" as string | null, host: "https://host-a" }));
vi.mock("./auth-token", () => ({ getStoredSession: () => identity.user ? { user_id: identity.user } : null }));
vi.mock("./host-config", () => ({ getResolvedHostOrigin: () => identity.host }));
const storageKey = "aura-viewed-files-v1";
describe("viewed file revisions", () => {
  beforeEach(() => { identity.user = "user-a"; identity.host = "https://host-a"; clearViewedFiles(); });
  afterEach(() => { vi.restoreAllMocks(); clearViewedFiles(); });
  it("fingerprints the whole patch and rejects incomplete/binary/no-text diffs", async () => {
    expect(await diffFingerprint(diff)).not.toBe(await diffFingerprint({ ...diff, diff: diff.diff + "changed" }));
    expect(await diffFingerprint({ ...diff, truncated: true })).toBeNull();
    expect(await diffFingerprint({ ...diff, binary: true })).toBeNull();
    expect(await diffFingerprint({ ...diff, diff: "" })).toBeNull();
  });
  it("keeps staged, working, branch, project, and remote reviews separate", () => {
    writeViewedFiles("local:project:branch", new Map([[viewedFileKey("app.ts", "worktree"), "hash"]]));
    expect(readViewedFiles("local:project:branch").has(viewedFileKey("app.ts", "staged"))).toBe(false);
    for (const scope of ["remote:project:branch", "local:other:branch", "local:project:other"]) expect(readViewedFiles(scope).size).toBe(0);
  });
  it("invalidates changed, removed, truncated, and unreadable files on revalidation", async () => {
    const hash = (await diffFingerprint(diff))!;
    const marks = new Map(["same", "changed", "removed", "truncated", "offline"].map((path) => [viewedFileKey(path, "worktree"), hash]));
    const valid = await revalidateViewedFiles(marks, ["same", "changed", "truncated", "offline"].map((path) => ({ path, worktree_status: "M" })), async (path) => {
      if (path === "offline") throw new Error("offline");
      return { ...diff, path, diff: path === "changed" ? "changed" : diff.diff, truncated: path === "truncated" };
    });
    expect([...valid.keys()]).toEqual([viewedFileKey("same", "worktree")]);
  });
  it("bounds metadata to 20 workspaces and 100 files each", () => {
    for (let i = 0; i < 21; i++) writeViewedFiles(String(i), new Map([["file", "hash"]]));
    expect(readViewedFiles("0").size).toBe(0);
    writeViewedFiles("many", new Map(Array.from({ length: 110 }, (_, i) => [String(i), "hash"])));
    expect(readViewedFiles("many").size).toBe(100);
    clearViewedFiles();
    expect(readViewedFiles("many").size).toBe(0);
  });

  it("restores digests in a fresh app instance and persists unmarking", async () => {
    const key = viewedFileKey(diff.path, diff.area);
    const hash = (await diffFingerprint(diff))!;
    writeViewedFiles("workspace", new Map([[key, hash]]));
    vi.resetModules();
    const restarted = await import("./source-control-viewed-files");
    expect(restarted.readViewedFiles("workspace").get(key)).toBe(hash);
    expect(window.localStorage.getItem(storageKey)).not.toContain(diff.diff);
    restarted.writeViewedFiles("workspace", new Map());
    vi.resetModules();
    const nextRestart = await import("./source-control-viewed-files");
    expect(nextRestart.readViewedFiles("workspace").size).toBe(0);
    nextRestart.clearViewedFiles();
  });

  it("isolates saved reviews by account and API host", () => {
    writeViewedFiles("workspace", new Map([[viewedFileKey("app.ts", "worktree"), "a".repeat(64)]]));
    const before = viewedFilesIdentity();
    identity.user = "user-b";
    expect(readViewedFiles("workspace").size).toBe(0);
    expect(viewedFilesIdentity()).not.toBe(before);
    identity.user = "user-a";
    expect(readViewedFiles("workspace").size).toBe(1);
    identity.host = "https://host-b";
    expect(readViewedFiles("workspace").size).toBe(0);
  });

  it("erases disk state on logout and invalidates in-flight review identities", () => {
    writeViewedFiles("workspace", new Map([[viewedFileKey("app.ts", "worktree"), "a".repeat(64)]]));
    const before = viewedFilesIdentity();
    clearViewedFiles();
    expect(viewedFilesIdentity()).not.toBe(before);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it.each(["{bad", JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, owner: '["https://host-a","user-a"]', workspaces: [["workspace", [["bad-key", "a".repeat(64)], [viewedFileKey("app.ts", "worktree"), "not-a-digest"]]]] })])(
    "rejects malformed records and invalid hashes: %s", (raw) => {
      window.localStorage.setItem(storageKey, raw);
      expect(readViewedFiles("workspace").size).toBe(0);
    },
  );

  it("retains an in-memory fallback if storage is denied or full", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeViewedFiles("workspace", new Map([["file", "hash"]]))).not.toThrow();
    expect(readViewedFiles("workspace").get("file")).toBe("hash");
    expect(() => clearViewedFiles()).not.toThrow();
  });
});
