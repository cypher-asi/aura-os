import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
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

const FORCE_FILE_KEYS = new Set([
  "AURA_EVAL_ACCESS_TOKEN",
  "AURA_ACCESS_TOKEN",
  "AURA_NETWORK_AUTH_TOKEN",
]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const body = fs.readFileSync(filePath, "utf8");
  for (const line of body.split(/\r?\n/g)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined || FORCE_FILE_KEYS.has(key)) {
      process.env[key] = value;
    }
  }
  return true;
}

export function loadExternalBenchmarkEnv({ repoRoot = process.cwd() } = {}) {
  const localStackDir = path.join(repoRoot, "infra/evals/local-stack");
  const runtimeDir =
    process.env.AURA_STACK_RUNTIME_DIR
    || path.join(localStackDir, ".runtime");

  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
    path.join(localStackDir, "stack.env"),
    path.join(runtimeDir, "evals.env"),
    path.join(runtimeDir, "auth.env"),
  ];

  const loaded = candidates.filter(loadEnvFile);

  if (!process.env.AURA_EVAL_ACCESS_TOKEN) {
    process.env.AURA_EVAL_ACCESS_TOKEN =
      process.env.AURA_ACCESS_TOKEN
      || process.env.AURA_NETWORK_AUTH_TOKEN
      || "";
  }

  if (!process.env.AURA_EVAL_ACCESS_TOKEN && process.env.AURA_STACK_AURA_OS_DATA_DIR) {
    const result = spawnSync(
      "cargo",
      [
        "run",
        "-q",
        "-p",
        "aura-os-server",
        "--bin",
        "print-auth-token",
        "--",
        process.env.AURA_STACK_AURA_OS_DATA_DIR,
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const token = result.status === 0 ? result.stdout.trim() : "";
    if (token) {
      process.env.AURA_EVAL_ACCESS_TOKEN = token;
    }
  }

  if (!process.env.ANTHROPIC_API_KEY && process.env.AURA_STACK_ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.AURA_STACK_ANTHROPIC_API_KEY;
  }

  if (!process.env.AURA_EVAL_API_BASE_URL && process.env.AURA_STACK_AURA_OS_PORT) {
    process.env.AURA_EVAL_API_BASE_URL = `http://127.0.0.1:${process.env.AURA_STACK_AURA_OS_PORT}`;
  }

  return loaded;
}
