import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewedFiles } from "./use-viewed-files";
import { clearViewedFiles, diffFingerprint, viewedFileKey } from "../../shared/lib/source-control-viewed-files";
import type { SourceControlDiff } from "../../shared/api/source-control";
vi.mock("../../shared/lib/auth-token", () => ({ getStoredSession: () => ({ user_id: "owner" }) }));
vi.mock("../../shared/lib/host-config", () => ({ getResolvedHostOrigin: () => "https://host" }));
const diff: SourceControlDiff = { path: "current", area: "worktree", diff: "-old\n+new", binary: false, truncated: false };
const files = [{ path: "current", worktree_status: "M" }, { path: "other", worktree_status: "M" }];
const storageKey = "aura-viewed-files-v1";
beforeEach(clearViewedFiles);
afterEach(clearViewedFiles);

async function seedSavedMarks() {
  const hash = await diffFingerprint(diff);
  window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, owner: '["https://host","owner"]', workspaces: [
    ["workspace", [[viewedFileKey("current", "worktree"), hash], [viewedFileKey("other", "worktree"), hash]]],
  ] }));
}

it("does not trust restored marks until current patches are revalidated", async () => {
  await seedSavedMarks();
  let resolve!: (diff: SourceControlDiff) => void;
  const load = vi.fn(() => new Promise<SourceControlDiff>((done) => { resolve = done; }));
  const { result } = renderHook(() => useViewedFiles("workspace", files, diff, 0, load));
  await waitFor(() => expect(load).toHaveBeenCalled());
  expect(result.current.marks.size).toBe(0);
  expect(result.current.canToggle).toBe(false);
  await act(async () => resolve({ ...diff, path: "other", diff: "+changed while app was closed" }));
  await waitFor(() => expect(result.current.canToggle).toBe(true));
  expect(result.current.viewed).toBe(true);
  expect(result.current.marks.has(viewedFileKey("other", "worktree"))).toBe(false);
  expect(window.localStorage.getItem(storageKey)).not.toContain('\\"other\\"');
});

it("cannot restore persisted review state from a pre-logout async response", async () => {
  await seedSavedMarks();
  let resolve!: (diff: SourceControlDiff) => void;
  const load = vi.fn(() => new Promise<SourceControlDiff>((done) => { resolve = done; }));
  const { result } = renderHook(() => useViewedFiles("workspace", files, diff, 0, load));
  await waitFor(() => expect(load).toHaveBeenCalled());
  clearViewedFiles();
  await act(async () => resolve({ ...diff, path: "other" }));
  expect(result.current.marks.size).toBe(0);
  expect(window.localStorage.getItem(storageKey)).toBeNull();
});
