import type { SourceControlArea, SourceControlDiff, SourceControlFile } from "../api/source-control";

// Review metadata only, never file contents. Session-memory, not GitHub state.
const reviews = new Map<string, Map<string, string>>();
const MAX_WORKSPACES = 20;
const MAX_FILES = 100;

export const viewedFileKey = (path: string, area: SourceControlArea): string => JSON.stringify([area, path]);
export const readViewedFiles = (scope: string): Map<string, string> => new Map(reviews.get(scope));
export function writeViewedFiles(scope: string, marks: Map<string, string>): Map<string, string> {
  const bounded = new Map([...marks].slice(-MAX_FILES));
  reviews.delete(scope);
  if (bounded.size) reviews.set(scope, bounded);
  if (reviews.size > MAX_WORKSPACES) reviews.delete(reviews.keys().next().value!);
  return new Map(bounded);
}
export function clearViewedFiles(): void { reviews.clear(); }

export async function diffFingerprint(diff: SourceControlDiff): Promise<string | null> {
  // A displayed prefix or generic binary notice is not evidence that the
  // complete change was reviewed. Fail closed if hashing is unavailable too.
  if (diff.truncated || diff.binary || !diff.diff) return null;
  const bytes = new TextEncoder().encode(diff.diff);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function revalidateViewedFiles(
  marks: Map<string, string>,
  files: SourceControlFile[],
  load: (path: string, area: SourceControlArea) => Promise<SourceControlDiff>,
): Promise<Map<string, string>> {
  const candidates = files.flatMap((file) => (["staged", "worktree"] as const)
    .filter((area) => area === "staged" ? file.staged_status : file.worktree_status)
    .map((area) => ({ path: file.path, area, key: viewedFileKey(file.path, area) })))
    .filter(({ key }) => marks.has(key));
  const valid = new Map<string, string>();
  // Avoid a fan-out proportional to the number of reviewed files.
  for (let index = 0; index < candidates.length; index += 4) {
    await Promise.all(candidates.slice(index, index + 4).map(async ({ path, area, key }) => {
      try {
        const diff = await load(path, area);
        if (diff.path !== path || diff.area !== area) return;
        const fingerprint = await diffFingerprint(diff);
        if (fingerprint && fingerprint === marks.get(key)) valid.set(key, fingerprint);
      } catch { /* Unreadable changes must be reviewed again, not kept checked. */ }
    }));
  }
  return valid;
}
