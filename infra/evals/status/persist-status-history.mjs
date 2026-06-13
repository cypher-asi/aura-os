#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildObservabilityIngestPayload,
  persistObservabilityRun,
  readSnapshot,
} from "./lib/status-persistence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function parseArgs(argv) {
  const args = {
    snapshot: process.env.AURA_STATUS_SNAPSHOT_FILE
      || process.env.AURA_STATUS_OUTPUT
      || path.join(repoRoot, "interface/public/observability/status.json"),
    storageUrl: process.env.AURA_STATUS_STORAGE_URL || process.env.AURA_STORAGE_URL || "",
    token: process.env.AURA_STATUS_STORAGE_INTERNAL_TOKEN
      || process.env.AURA_STORAGE_INTERNAL_TOKEN
      || process.env.INTERNAL_SERVICE_TOKEN
      || "",
    enabled: !["0", "false", "no"].includes(String(process.env.AURA_STATUS_PERSIST_HISTORY || "1").toLowerCase()),
    timeoutMs: Number(process.env.AURA_STATUS_STORAGE_TIMEOUT_MS || "30000"),
    releaseChannel: process.env.AURA_STATUS_RELEASE_CHANNEL || process.env.AURA_RELEASE_CHANNEL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--snapshot") args.snapshot = path.resolve(next());
    else if (arg === "--storage-url") args.storageUrl = next();
    else if (arg === "--token") args.token = next();
    else if (arg === "--release-channel") args.releaseChannel = next();
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next());
    else if (arg === "--disabled") args.enabled = false;
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/persist-status-history.mjs [--snapshot FILE] [--storage-url URL] [--token TOKEN]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.snapshot = path.resolve(args.snapshot);
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 30_000;
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.enabled) {
  process.stdout.write("Observability history persistence disabled.\n");
  process.exit(0);
}

if (!args.storageUrl || !args.token) {
  process.stdout.write("Skipping observability history persistence because storage URL or internal token is not configured.\n");
  process.exit(0);
}

const snapshot = await readSnapshot(args.snapshot);
const payload = buildObservabilityIngestPayload(snapshot, {
  source: process.env.AURA_STATUS_SOURCE,
  environment: process.env.AURA_STATUS_ENVIRONMENT,
  externalRunId: process.env.AURA_STATUS_EXTERNAL_RUN_ID || process.env.GITHUB_RUN_ID,
  externalRunAttempt: process.env.AURA_STATUS_EXTERNAL_RUN_ATTEMPT || process.env.GITHUB_RUN_ATTEMPT,
  gitSha: process.env.AURA_STATUS_GIT_SHA || process.env.GITHUB_SHA,
  gitBranch: process.env.AURA_STATUS_GIT_BRANCH || process.env.GITHUB_REF_NAME,
  workflowName: process.env.AURA_STATUS_WORKFLOW_NAME || process.env.GITHUB_WORKFLOW,
  releaseChannel: args.releaseChannel,
  completedAt: new Date().toISOString(),
});

const run = await persistObservabilityRun({
  storageUrl: args.storageUrl,
  token: args.token,
  payload,
  timeoutMs: args.timeoutMs,
});

process.stdout.write(`Persisted observability run ${run?.id ?? "(unknown id)"} to Aura storage.\n`);
