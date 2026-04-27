#!/usr/bin/env node
/**
 * Terminal-Bench → AURA pipeline bridge.
 *
 * Reads a JSON payload describing a single Terminal-Bench task, builds a
 * LiveBenchmarkScenario in memory, and invokes runScenario from the Phase 1
 * library at interface/scripts/lib/benchmark-api-runner.mjs. Streams progress
 * to stderr and prints a single JSON status line to stdout when finished.
 *
 * CLI:
 *   node infra/evals/external/tbench/bin/run-aura-pipeline.mjs <payload-file>
 *
 * Payload shape (JSON):
 *   {
 *     "task_id": "...",
 *     "task_description": "...",
 *     "workspace_dir": "/abs/host/path/to/tb/workspace",
 *     "loop_timeout_ms": 1500000,
 *     "aura_api_base_url": "http://127.0.0.1:3190",
 *     "aura_access_token": "...",
 *     "aura_storage_url": ""
 *   }
 *
 * Stdout (single line, parsed by the Python shim):
 *   on success: { ok: true, runId, status: "agent_complete", costUsd, totalTokens, fileChangeCount }
 *   on error:   { ok: false, runId: null, status: "agent_error", error: "..." }
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBenchmarkClient,
  runScenario,
} from "../../../../../interface/scripts/lib/benchmark-api-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function emitStatus(status) {
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

function emitProgress(entry) {
  try {
    process.stderr.write(`[aura-tbench] ${JSON.stringify(entry)}\n`);
  } catch {
    // Ignore logging failures so they cannot break the pipeline.
  }
}

function fail(error, runId) {
  const message = error instanceof Error ? error.message : String(error);
  emitStatus({
    ok: false,
    runId: runId ?? null,
    status: "agent_error",
    error: message,
  });
  process.exit(1);
}

async function readPayload(payloadPath) {
  if (!payloadPath) {
    throw new Error("Missing payload-file argument.");
  }
  const absolutePayload = path.resolve(payloadPath);
  const raw = await fs.readFile(absolutePayload, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Invalid JSON payload at ${absolutePayload}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  return parsed;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Payload field ${label} is required and must be a non-empty string.`);
  }
  return value;
}

function requireAbsolute(value, label) {
  const resolved = requireString(value, label);
  if (!path.isAbsolute(resolved)) {
    throw new Error(`Payload field ${label} must be an absolute path (got ${resolved}).`);
  }
  return resolved;
}

function buildScenario(payload) {
  const workspaceDir = requireAbsolute(payload.workspace_dir, "workspace_dir");
  const taskId = requireString(payload.task_id, "task_id");
  const taskDescription = requireString(payload.task_description, "task_description");
  const loopTimeoutMs =
    typeof payload.loop_timeout_ms === "number" && Number.isFinite(payload.loop_timeout_ms)
      ? payload.loop_timeout_ms
      : 1500000;

  const buildCommand =
    process.env.AURA_BENCH_BUILD_COMMAND
    ?? `bash -c "echo 'tbench placeholder build'"`;
  const testCommand =
    process.env.AURA_BENCH_TEST_COMMAND
    ?? `bash -c "echo 'tbench placeholder test'"`;

  return {
    id: `tbench-${taskId}`,
    suite: "external_benchmark",
    kind: "tbench_2_core",
    title: `Terminal-Bench task — ${taskId}`,
    devices: ["api-local"],
    canonicalPrompts: [taskDescription],
    agentTemplate: {
      name: "Aura-TBench-Builder",
      role: "Engineer",
      personality: "Methodical, careful, benchmark-focused.",
      systemPrompt:
        "You are AURA running a single Terminal-Bench task. The task description is in requirements.md. Make whatever changes are required to make the task verification pass.",
      machineType: "local",
      adapterType: "aura_harness",
      environment: "local_host",
    },
    project: {
      name: `Aura T-Bench ${taskId}`,
      description: `T-Bench task ${taskId}`,
      fixtureAbsolutePath: workspaceDir,
      buildCommand,
      testCommand,
      artifactChecks: [],
    },
    timeouts: {
      loginMs: 30000,
      loopCompletionMs: loopTimeoutMs,
      pollIntervalMs: 5000,
    },
    verification: {
      requireNoFailedTasks: false,
      requireAnyDoneTasks: false,
      requireBuildSteps: false,
      requireTestSteps: false,
      statsTexts: [],
    },
  };
}

function buildRequirementsMarkdown(taskId, taskDescription) {
  return [
    `# Terminal-Bench task: ${taskId}`,
    "",
    "## Task",
    "",
    taskDescription,
    "",
    "## Notes",
    "",
    "- The task verifier is hidden. Make changes that satisfy the literal task description.",
    "- Do not introduce extra dependencies; use what is already on the system.",
    "",
  ].join("\n");
}

async function writeRequirementsFile(workspaceDir, taskId, taskDescription) {
  const requirementsPath = path.join(workspaceDir, "requirements.md");
  const body = buildRequirementsMarkdown(taskId, taskDescription);
  await fs.writeFile(requirementsPath, body, "utf8");
  return requirementsPath;
}

async function main() {
  const [, , payloadPath] = process.argv;
  let runId = null;
  let payload;
  try {
    payload = await readPayload(payloadPath);
  } catch (error) {
    fail(error, runId);
    return;
  }

  try {
    const apiBaseUrl = requireString(payload.aura_api_base_url, "aura_api_base_url");
    const accessToken = requireString(payload.aura_access_token, "aura_access_token");
    const storageUrl =
      typeof payload.aura_storage_url === "string" ? payload.aura_storage_url : "";

    const scenario = buildScenario(payload);
    runId = scenario.id;
    await writeRequirementsFile(
      scenario.project.fixtureAbsolutePath,
      requireString(payload.task_id, "task_id"),
      requireString(payload.task_description, "task_description"),
    );

    const client = createBenchmarkClient({
      apiBaseUrl,
      accessToken,
      storageUrl,
      verbose: true,
    });

    emitProgress({ step: "bridge_start", scenarioId: scenario.id });

    const result = await runScenario(scenario, {
      client,
      onProgress: (entry) => emitProgress({ step: "scenario_progress", entry }),
    });

    runId = result.runId ?? scenario.id;
    const metrics = result.metrics ?? {};
    emitStatus({
      ok: true,
      runId,
      status: "agent_complete",
      costUsd: Number(metrics.estimatedCostUsd ?? 0),
      totalTokens: Number(metrics.totalTokens ?? 0),
      fileChangeCount: Number(metrics.fileChangeCount ?? 0),
    });
  } catch (error) {
    fail(error, runId);
  }
}

await main();
