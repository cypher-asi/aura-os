#!/usr/bin/env node
// CLI wrapper around runLivePipelinePreflight. Used by the SWE-bench and
// Terminal-Bench runners to verify every vital backend path right after
// authentication, before kicking off long benchmark runs.
//
// Streams structured progress to stderr and prints a single JSON summary
// line to stdout when complete. Exits non-zero on the first failed step.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExternalBenchmarkEnv } from "../../infra/evals/external/bin/load-env.mjs";
import { createBenchmarkClient } from "./lib/benchmark-api-runner.mjs";
import { runLivePipelinePreflight } from "./lib/live-pipeline-preflight.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const interfaceRoot = path.resolve(currentDir, "..");
const defaultFixtureDir = path.join(
  interfaceRoot,
  "tests",
  "e2e",
  "evals",
  "fixtures",
  "preflight-minimal",
);

loadExternalBenchmarkEnv({ repoRoot });

const apiBaseUrl = process.env.AURA_EVAL_API_BASE_URL?.trim()
  || process.env.AURA_EVAL_BASE_URL?.trim()
  || "http://127.0.0.1:3190";
const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
const storageUrl = process.env.AURA_EVAL_STORAGE_URL?.trim() || "";
const fixtureDir = process.env.AURA_BENCH_PREFLIGHT_FIXTURE?.trim()
  || defaultFixtureDir;

if (!accessToken) {
  process.stderr.write(
    "[preflight] AURA_EVAL_ACCESS_TOKEN is empty. Run zOS login (the SWE-bench/TBench wrapper does this) before invoking preflight.\n",
  );
  process.exit(2);
}

function logStep(record) {
  const { step, status, elapsedMs } = record;
  const tag = status === "ok" ? "ok  " : "FAIL";
  const detail = record.error
    ? ` :: ${record.error}`
    : record.details
      ? ` :: ${JSON.stringify(record.details)}`
      : "";
  process.stderr.write(`[preflight] ${tag} ${step} (${elapsedMs}ms)${detail}\n`);
}

async function main() {
  const client = createBenchmarkClient({
    apiBaseUrl,
    accessToken,
    storageUrl,
    verbose: false,
  });

  process.stderr.write(
    `[preflight] live pipeline preflight against ${apiBaseUrl}\n`,
  );

  try {
    const result = await runLivePipelinePreflight({
      client,
      fixtureDir,
      onStep: logStep,
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, totalElapsedMs: result.totalElapsedMs })}\n`,
    );
    process.exit(0);
  } catch (error) {
    const step = error?.step ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      `${JSON.stringify({ ok: false, failedStep: step, error: message })}\n`,
    );
    process.stderr.write(`[preflight] aborting: ${message}\n`);
    process.exit(1);
  }
}

await main();
