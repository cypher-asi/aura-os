import fs from "node:fs";
import path from "node:path";

import { resolveDemoRepoPath } from "./demo-repo-paths.mjs";

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

export function loadLocalEnv({
  rootDir = resolveDemoRepoPath(),
  files = [".env.local", ".env"],
} = {}) {
  const loaded = [];
  for (const fileName of files) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    const body = fs.readFileSync(filePath, "utf8");
    for (const line of body.split(/\r?\n/g)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    loaded.push(filePath);
  }
  return loaded;
}
