import type { SourceControlArea, SourceControlDiff, SourceControlFile } from "../api/source-control";
import { getStoredSession } from "./auth-token";
import { getResolvedHostOrigin } from "./host-config";

// Device-local review metadata only, never file contents or GitHub state.
const reviews = new Map<string, Map<string, string>>();
const MAX_WORKSPACES = 20;
const MAX_FILES = 100;
const STORAGE_KEY = "aura-viewed-files-v1";
const MAX_RECORD_CHARS = 256 * 1024;
let activeOwner: string | null | undefined;
let epoch = 0;

function currentOwner(): string | null {
  try {
    const userId = getStoredSession()?.user_id;
    const host = userId ? getResolvedHostOrigin() : "";
    return userId && host ? JSON.stringify([host, userId]) : null;
  } catch { return null; }
}

function validFileKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 2048) return false;
  try {
    const parts = JSON.parse(key);
    return Array.isArray(parts) && parts.length === 2 && ["staged", "worktree"].includes(parts[0])
      && typeof parts[1] === "string" && parts[1].length > 0;
  } catch { return false; }
}

function ensureOwner(): void {
  const owner = currentOwner();
  if (owner === activeOwner) return;
  reviews.clear();
  activeOwner = owner;
  epoch++;
  if (!owner || typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_RECORD_CHARS) return;
    const record = JSON.parse(raw);
    if (record?.version !== 1 || record.owner !== owner || !Array.isArray(record.workspaces)) return;
    for (const entry of record.workspaces.slice(-MAX_WORKSPACES)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].length > 4096 || !Array.isArray(entry[1])) continue;
      const marks = new Map<string, string>();
      for (const mark of entry[1].slice(-MAX_FILES)) {
        if (Array.isArray(mark) && validFileKey(mark[0]) && typeof mark[1] === "string" && /^[a-f0-9]{64}$/.test(mark[1])) {
          marks.set(mark[0], mark[1]);
        }
      }
      if (marks.size) reviews.set(entry[0], marks);
    }
  } catch { /* Corrupt/unavailable storage cannot make a file appear reviewed. */ }
}

function persist(): void {
  if (!activeOwner || currentOwner() !== activeOwner || typeof window === "undefined") return;
  try {
    const workspaces = [...reviews].map(([scope, marks]) => [scope, [...marks]]);
    let value = JSON.stringify({ version: 1, owner: activeOwner, workspaces });
    while (value.length > MAX_RECORD_CHARS && workspaces.length) {
      workspaces.shift();
      value = JSON.stringify({ version: 1, owner: activeOwner, workspaces });
    }
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch { /* Retain the memory fallback if quota/privacy settings block writes. */ }
}

/** Guards async diff reads against logout/account/host changes. */
export function viewedFilesIdentity(): string {
  ensureOwner();
  return JSON.stringify([activeOwner, epoch]);
}

export const viewedFileKey = (path: string, area: SourceControlArea): string => JSON.stringify([area, path]);
export function readViewedFiles(scope: string): Map<string, string> {
  ensureOwner();
  return new Map(reviews.get(scope));
}
export function writeViewedFiles(scope: string, marks: Map<string, string>): Map<string, string> {
  ensureOwner();
  const bounded = new Map([...marks].slice(-MAX_FILES));
  reviews.delete(scope);
  if (bounded.size) reviews.set(scope, bounded);
  if (reviews.size > MAX_WORKSPACES) reviews.delete(reviews.keys().next().value!);
  persist();
  return new Map(bounded);
}
export function clearViewedFiles(): void {
  reviews.clear();
  activeOwner = undefined;
  epoch++;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}

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
