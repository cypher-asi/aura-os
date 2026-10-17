import { beforeEach, describe, expect, it } from "vitest";
import { clearViewedFiles, diffFingerprint, readViewedFiles, revalidateViewedFiles, viewedFileKey, writeViewedFiles } from "./source-control-viewed-files";
import type { SourceControlDiff } from "../api/source-control";

const diff: SourceControlDiff = { path: "app.ts", area: "worktree", diff: "-old\n+new", binary: false, truncated: false };
describe("viewed file revisions", () => {
  beforeEach(clearViewedFiles);
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
});
