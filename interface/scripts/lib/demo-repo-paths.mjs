import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEMO_REPO_ROOT = path.resolve(MODULE_DIR, "../../..");
export const DEMO_INTERFACE_ROOT = path.join(DEMO_REPO_ROOT, "interface");

export function toRepoRelativePath(value) {
  return path.relative(DEMO_REPO_ROOT, value).replace(/\\/g, "/");
}

export function resolveDemoRepoPath(...parts) {
  return path.join(DEMO_REPO_ROOT, ...parts);
}

export function resolveDemoChangedFilePath(filePath) {
  const normalizedPath = String(filePath || "").trim().replace(/\\/g, "/");
  if (!normalizedPath) {
    return null;
  }

  if (path.isAbsolute(normalizedPath)) {
    return normalizedPath;
  }

  const candidatePaths = normalizedPath.startsWith("interface/")
    ? [path.join(DEMO_REPO_ROOT, normalizedPath)]
    : [
      path.join(DEMO_REPO_ROOT, normalizedPath),
      path.join(DEMO_INTERFACE_ROOT, normalizedPath),
    ];

  return candidatePaths.find((candidate) => fs.existsSync(candidate)) ?? candidatePaths[0];
}
