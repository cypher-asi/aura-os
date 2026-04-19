import { useEffect, useState } from "react";
import { api } from "../api/client";

/**
 * Cached workspace root fetched from `/api/system/workspace_defaults`.
 *
 * Returns `null` until the first successful fetch; errors are swallowed
 * because callers use this for display-only "default path" previews and
 * can gracefully degrade to a generic placeholder.
 */
let cachedWorkspaceRoot: string | null = null;
let inFlight: Promise<string> | null = null;

async function loadWorkspaceRoot(): Promise<string> {
  if (cachedWorkspaceRoot) return cachedWorkspaceRoot;
  if (!inFlight) {
    inFlight = api.environment
      .getWorkspaceDefaults()
      .then((response) => {
        cachedWorkspaceRoot = response.workspace_root;
        return cachedWorkspaceRoot;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function useWorkspaceRoot(): string | null {
  const [root, setRoot] = useState<string | null>(cachedWorkspaceRoot);

  useEffect(() => {
    let cancelled = false;
    if (cachedWorkspaceRoot) {
      setRoot(cachedWorkspaceRoot);
      return () => {
        cancelled = true;
      };
    }
    loadWorkspaceRoot()
      .then((value) => {
        if (!cancelled) setRoot(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return root;
}

/** Join a workspace root with a project id / subfolder using the platform's separator. */
export function joinWorkspacePath(
  root: string | null,
  segment: string,
): string {
  if (!root) return "";
  const usesBackslash = root.includes("\\") && !root.includes("/");
  const sep = usesBackslash ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  return `${trimmedRoot}${sep}${segment}`;
}
