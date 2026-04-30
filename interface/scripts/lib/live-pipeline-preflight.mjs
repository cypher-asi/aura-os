// Live preflight that exercises every vital backend path used by the
// SWE-bench / Terminal-Bench long runs against a real running stack.
//
// Order of steps mirrors `runScenario` in benchmark-api-runner.mjs so a
// failure here means the long benchmark would also fail at the same point:
//
//   1.  GET    /api/auth/session                       -> auth still valid
//   2.  POST   /api/auth/import-access-token           -> session import path
//   3.  GET    /api/orgs                               -> org list
//   4.  POST   /api/orgs                               -> create-or-resolve org
//   5.  POST   /api/agents                             -> agent CRUD
//   6.  POST   /api/projects                           -> import-by-reference
//   7.  POST   /api/projects/:id/agents                -> attach instance
//   8.  POST   /api/projects/:id/agents/:aid/events/stream
//                                                      -> SSE chat / spec gen
//   9.  GET    /api/projects/:id/specs                 -> >= 1 spec
//  10.  POST   /api/projects/:id/tasks/extract         -> >= 1 task
//  11.  POST   /api/projects/:id/loop/start
//        + GET /api/projects/:id/tasks (poll)          -> >= 1 terminal task
//  12.  GET    /api/projects/:id/stats
//        + GET /api/projects/:id/agents/:aid/sessions  -> telemetry surfaces
//
// Cleanup runs in a finally block regardless of failure (project, agent
// instance, agent, integration, org). Each step is timed and emits a
// structured `{ step, status, elapsedMs, details }` record via `onStep`.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  describeRequestContractSummary,
  extractRequestContractReports,
  summarizeRequestContractReports,
} from "../../../infra/evals/external/swebench/lib/request-contract-reporting.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_LOOP_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_SPEC_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_PREFLIGHT_ORG_NAME = "Aura Preflight";
const FIXTURE_PROFILE_MINIMAL = "minimal";
const FIXTURE_PROFILE_SWE_SHAPED_MOCK = "swe_shaped_mock";

const FULL_ACCESS_CAPABILITIES = Object.freeze([
  "spawnAgent",
  "controlAgent",
  "readAgent",
  "listAgents",
  "manageOrgMembers",
  "manageBilling",
  "invokeProcess",
  "postToFeed",
  "generateMedia",
  "readAllProjects",
  "writeAllProjects",
]);

function fullAccessPermissions() {
  return {
    scope: { orgs: [], projects: [], agent_ids: [] },
    capabilities: FULL_ACCESS_CAPABILITIES.map((type) => ({ type })),
  };
}

function fixtureProfileLabel(profile) {
  const value = String(profile ?? "").trim();
  return value || FIXTURE_PROFILE_MINIMAL;
}

function requirementsForFixtureProfile(profile) {
  const selected = fixtureProfileLabel(profile);
  if (selected !== FIXTURE_PROFILE_SWE_SHAPED_MOCK) {
    return [
      "# Preflight task",
      "",
      "Create a file named `hello.txt` whose contents are exactly the single line:",
      "",
      "```",
      "hello",
      "```",
      "",
      "Treat this as a single implementation task. Do not create a separate verification task.",
      "",
    ];
  }

  return [
    "# SWE-shaped mock issue",
    "",
    "Repository: mock/astropy-like",
    "Base commit: 0000000000000000000000000000000000000000",
    "Instance: mock__mock-00001",
    "",
    "## Problem Statement",
    "",
    "A nested compound model expression is treated incorrectly when a right-hand branch",
    "returns a plain ndarray-like separability block. The implementation should preserve",
    "the right branch shape when stacking left and right components.",
    "",
    "Observed failure from the user report:",
    "",
    "```text",
    "E       AssertionError: separability_matrix returned an incorrectly nested matrix",
    "E       expected [[ True, False, False, False],",
    "E                 [False,  True, False, False],",
    "E                 [False, False,  True,  True ]]",
    "E       got      [[ True, False, False, False],",
    "E                 [False,  True, False, False],",
    "E                 [False, False,  True, False]]",
    "```",
    "",
    "## Relevant Files",
    "",
    "- `mock_modeling/separable.py`",
    "- `tests/test_separable.py`",
    "",
    "## Expected Work",
    "",
    "1. Inspect the existing helper that stacks left and right separability blocks.",
    "2. Make the smallest code change needed to preserve nested right-hand ndarray blocks.",
    "3. Add or update a focused test that would fail before the fix.",
    "4. Run the available test command before calling `task_done`.",
    "",
    "## Constraints",
    "",
    "- Do not rewrite unrelated modeling behavior.",
    "- Do not add network access, external dependencies, or generated artifacts.",
    "- Keep changes scoped to the files listed above unless inspection proves another",
    "  file is the correct owner.",
    "",
    "This is synthetic preflight content. It intentionally resembles a SWE-bench issue",
    "shape while remaining small and safe. The goal is to exercise the autonomous loop's",
    "request formation before the real benchmark driver starts.",
    "",
  ];
}

function authHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function requestContractSummaryFromPreflightSurfaces(...surfaces) {
  const inputs = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    inputs.push(value);
    for (const key of [
      "request_contract",
      "requestContract",
      "request_contract_verdict",
      "requestContractVerdict",
      "classifier_verdict",
      "classifierVerdict",
      "request_contract_reports",
      "requestContractReports",
      "model_content_profiles",
      "modelContentProfiles",
    ]) {
      const nested = value[key];
      if (Array.isArray(nested)) nested.forEach(visit);
      else visit(nested);
    }
  };
  surfaces.forEach(visit);
  return summarizeRequestContractReports(extractRequestContractReports(inputs, "preflight"));
}

async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const lfIdx = buffer.indexOf("\n\n");
      const crlfIdx = buffer.indexOf("\r\n\r\n");
      let sep = -1;
      let sepLen = 0;
      if (lfIdx !== -1 && (crlfIdx === -1 || lfIdx < crlfIdx)) {
        sep = lfIdx;
        sepLen = 2;
      } else if (crlfIdx !== -1) {
        sep = crlfIdx;
        sepLen = 4;
      }
      if (sep === -1) break;
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + sepLen);
      let eventType = "message";
      const dataLines = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).replace(/^ /, "");
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      const dataText = dataLines.length > 0 ? dataLines.join("\n") : null;
      yield { eventType, data: dataText !== null ? safeJsonParse(dataText) : null };
    }
  }
}

class StepFailure extends Error {
  constructor(step, message, details = {}) {
    super(`${step}: ${message}`);
    this.step = step;
    this.details = details;
  }
}

function emit(onStep, record) {
  if (typeof onStep !== "function") return;
  try {
    onStep(record);
  } catch {
    // Listener errors must never break the preflight.
  }
}

async function timedStep(onStep, step, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const elapsedMs = Date.now() - startedAt;
    emit(onStep, { step, status: "ok", elapsedMs, details: result?.detailsForLog ?? null });
    return result;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof StepFailure) {
      emit(onStep, {
        step,
        status: "fail",
        elapsedMs,
        error: error.message,
        details: error.details,
      });
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    emit(onStep, { step, status: "fail", elapsedMs, error: message });
    throw new StepFailure(step, message);
  }
}

// Names that must never be carried into the ephemeral copy of a
// persistent fixture. Each preflight run must start from a hermetic
// snapshot so prior runs cannot poison the next: `hello.txt` is the
// task's expected output (its presence pre-empts the agent's write
// and triggers the same-turn write-blocked detector); `.git` would
// import prior commits/HEAD that the dev-loop git tooling would diff
// against; `node_modules` and friends are bulky and irrelevant.
const FIXTURE_COPY_SKIP_NAMES = new Set([
  ".git",
  "node_modules",
  ".cache",
  "dist",
  "build",
  // Run-artifacts: `hello.txt` is the task's expected output (its
  // presence pre-empts the agent's first write and trips the
  // same-turn write-blocked detector); `spec/` is gitignored mirror
  // output written by `mirror_spec_best_effort` after spec generation
  // — leftover slugs from prior runs accumulate here and confuse the
  // task extractor.
  "hello.txt",
  "spec",
]);

// Recursively copy `srcDir` to `destDir`, skipping any entry whose
// basename is in `FIXTURE_COPY_SKIP_NAMES`. Used to materialise a
// hermetic per-run snapshot of a persistent fixture. We deliberately
// avoid `fs.cp` filter callbacks because the supported signature
// changed across Node 18/20 and we want consistent behaviour.
async function copyFixtureSnapshot(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (FIXTURE_COPY_SKIP_NAMES.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyFixtureSnapshot(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const target = await fs.readlink(srcPath);
      await fs.symlink(target, destPath).catch(async () => {
        // On Windows without developer mode, symlinks may fail; fall
        // back to copying the dereferenced contents.
        await fs.copyFile(srcPath, destPath);
      });
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function writeFixtureFiles(tempRoot, profile) {
  await fs.writeFile(
    path.join(tempRoot, "requirements.md"),
    requirementsForFixtureProfile(profile).join("\n"),
    "utf8",
  );
  // Tiny `node -e` scripts so the agent can demonstrate
  // `npm run build` / `npm run test` without an `npm install` step.
  // The project record below intentionally uses `node --version`
  // for its direct harness gates so this preflight stays portable on
  // Windows hosts where npm's `.cmd` shim may not resolve.
  await fs.writeFile(
    path.join(tempRoot, "package.json"),
    JSON.stringify(
      {
        name: "aura-preflight-fixture",
        private: true,
        version: "0.0.0",
        scripts: {
          build: "node -e \"console.log('preflight build ok')\"",
          test: "node -e \"console.log('preflight test ok')\"",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  if (fixtureProfileLabel(profile) === FIXTURE_PROFILE_SWE_SHAPED_MOCK) {
    await fs.mkdir(path.join(tempRoot, "mock_modeling"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "mock_modeling", "separable.py"),
      [
        "def cstack(left, right):",
        "    \"\"\"Mock separability stack helper used by preflight.\"\"\"",
        "    return [left, right]",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "tests", "test_separable.py"),
      [
        "from mock_modeling.separable import cstack",
        "",
        "",
        "def test_cstack_preserves_right_branch():",
        "    assert cstack([[True]], [[False, True]]) == [[[True]], [[False, True]]]",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

async function ensureFixtureDir(fixtureDir, profile = FIXTURE_PROFILE_MINIMAL) {
  if (typeof fixtureDir !== "string" || fixtureDir.length === 0) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aura-preflight-"));
    await writeFixtureFiles(tempRoot, profile);
    return { fixtureDir: tempRoot, ephemeral: true };
  }
  if (!path.isAbsolute(fixtureDir)) {
    throw new StepFailure(
      "validate_fixture",
      `fixtureDir must be absolute (got ${fixtureDir})`,
    );
  }
  try {
    const stat = await fs.stat(fixtureDir);
    if (!stat.isDirectory()) {
      throw new StepFailure(
        "validate_fixture",
        `fixtureDir is not a directory: ${fixtureDir}`,
      );
    }
  } catch (cause) {
    if (cause instanceof StepFailure) throw cause;
    throw new StepFailure(
      "validate_fixture",
      `fixtureDir is not accessible: ${fixtureDir} (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
  // Materialise a hermetic per-run snapshot so prior runs (stale
  // `hello.txt`, an inherited `.git`, leftover build outputs) cannot
  // poison this preflight. The original persistent fixture stays
  // untouched and source-controlled; the tmp copy is removed by the
  // outer `finally` block via the `ephemeral` flag.
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aura-preflight-fixture-"));
  try {
    await copyFixtureSnapshot(fixtureDir, tempRoot);
  } catch (cause) {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new StepFailure(
      "validate_fixture",
      `failed to snapshot fixture ${fixtureDir} into ${tempRoot}: ${message}`,
    );
  }
  return { fixtureDir: tempRoot, ephemeral: true };
}

// `loop_start` runs `validate_workspace_is_initialised` server-side and
// rejects any workspace without a `.git` entry. The persistent
// `interface/tests/e2e/evals/fixtures/preflight-minimal` fixture isn't
// itself a repo (it's source-controlled inside aura-os), and the
// ephemeral tmp-dir path doesn't init one either, so loop_start used to
// 400 with `workspace at ... is not a git repository`. Idempotently
// `git init` + create an initial commit so the validator passes and the
// dev loop has a HEAD to diff/commit against. Skips silently when a
// `.git` already exists (e.g. operator pre-cloned a real repo).
async function ensureWorkspaceIsGitRepo(fixtureDir) {
  const gitPath = path.join(fixtureDir, ".git");
  try {
    await fs.stat(gitPath);
    return { initialized: false };
  } catch (cause) {
    if (cause?.code !== "ENOENT") {
      throw new StepFailure(
        "init_fixture_repo",
        `failed to inspect ${gitPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  // `-c user.{name,email}=...` scopes the identity to this invocation
  // only, so we don't depend on the operator having global git config
  // and we don't pollute their machine config either. `--no-gpg-sign`
  // keeps the commit non-interactive on machines where commit signing
  // is enabled by default. We deliberately do NOT pass `-b main`: that
  // would require git >= 2.28 and the dev loop doesn't care about the
  // initial branch name.
  const identityFlags = [
    "-c", "user.name=Aura Preflight",
    "-c", "user.email=preflight@aura.local",
    "-c", "commit.gpgsign=false",
    "-c", "tag.gpgsign=false",
  ];
  try {
    await execFileAsync("git", [...identityFlags, "init", "-q"], { cwd: fixtureDir });
    await execFileAsync("git", [...identityFlags, "add", "-A"], { cwd: fixtureDir });
    await execFileAsync(
      "git",
      [
        ...identityFlags,
        "commit",
        "-q",
        "--allow-empty",
        "--no-gpg-sign",
        "-m",
        "preflight base",
      ],
      { cwd: fixtureDir },
    );
  } catch (cause) {
    const message = cause instanceof Error
      ? `${cause.message}${cause.stderr ? `\nstderr: ${String(cause.stderr).trim()}` : ""}`
      : String(cause);
    throw new StepFailure(
      "init_fixture_repo",
      `failed to initialise ${fixtureDir} as a git repo: ${message}`,
      { hint: "ensure git is on PATH and the fixture directory is writable" },
    );
  }
  return { initialized: true };
}

async function deleteIgnoringMissing(client, endpoint) {
  if (!endpoint) return { ok: true, status: 0, skipped: true };
  try {
    const response = await fetch(`${client.apiBaseUrl}${endpoint}`, {
      method: "DELETE",
      headers: authHeaders(client.accessToken),
    });
    return { ok: response.ok || response.status === 404, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function cleanupCreatedEntities(client, ids, onStep) {
  // Best-effort. We mirror the cleanup order the long-running benchmark uses
  // (integration -> agent_instance -> project -> agent) and treat 404/409 as
  // expected-on-some-stacks (e.g. agent has historical sessions). The org is
  // intentionally left in place even when we created it: the API doesn't
  // expose a DELETE /api/orgs/:id, and reusing "Aura Preflight" across runs
  // is harmless.
  const results = [];
  if (ids.orgId && ids.integrationId) {
    results.push({
      resource: "integration",
      id: ids.integrationId,
      ...(await deleteIgnoringMissing(
        client,
        `/api/orgs/${ids.orgId}/integrations/${ids.integrationId}`,
      )),
    });
  }
  if (ids.projectId && ids.agentInstanceId) {
    results.push({
      resource: "agent_instance",
      id: ids.agentInstanceId,
      ...(await deleteIgnoringMissing(
        client,
        `/api/projects/${ids.projectId}/agents/${ids.agentInstanceId}`,
      )),
    });
  }
  if (ids.projectId) {
    results.push({
      resource: "project",
      id: ids.projectId,
      ...(await deleteIgnoringMissing(client, `/api/projects/${ids.projectId}`)),
    });
  }
  if (ids.agentId) {
    results.push({
      resource: "agent",
      id: ids.agentId,
      ...(await deleteIgnoringMissing(client, `/api/agents/${ids.agentId}`)),
    });
  }
  emit(onStep, {
    step: "cleanup",
    status: "ok",
    elapsedMs: 0,
    details: { results },
  });
  return results;
}

function resolveRuntimeConfig() {
  const adapterType = process.env.AURA_EVAL_AGENT_ADAPTER_TYPE?.trim() || "aura_harness";
  const integrationProvider = process.env.AURA_EVAL_AGENT_INTEGRATION_PROVIDER?.trim() || "";
  return {
    adapterType,
    environment:
      process.env.AURA_EVAL_AGENT_ENVIRONMENT?.trim() || "local_host",
    authSource:
      process.env.AURA_EVAL_AGENT_AUTH_SOURCE?.trim()
      || (integrationProvider ? "org_integration" : "aura_managed"),
    integrationProvider,
    integrationName: process.env.AURA_EVAL_AGENT_INTEGRATION_NAME?.trim() || "",
    defaultModel: process.env.AURA_EVAL_AGENT_DEFAULT_MODEL?.trim() || "",
    apiKey: process.env.AURA_EVAL_AGENT_INTEGRATION_API_KEY?.trim() || "",
    machineType: process.env.AURA_EVAL_AGENT_MACHINE_TYPE?.trim() || "local",
  };
}

export async function runLivePipelinePreflight(options = {}) {
  const { client } = options;
  if (!client || typeof client.apiJson !== "function") {
    throw new Error("runLivePipelinePreflight: options.client is required");
  }
  const onStep = typeof options.onStep === "function" ? options.onStep : null;
  const orgName = options.orgName ?? process.env.AURA_EVAL_PREFLIGHT_ORG_NAME?.trim()
    ?? DEFAULT_PREFLIGHT_ORG_NAME;
  const loopTimeoutMs = Number(
    options.loopTimeoutMs
      ?? process.env.AURA_BENCH_PREFLIGHT_LOOP_TIMEOUT_MS
      ?? DEFAULT_LOOP_TIMEOUT_MS,
  );
  const pollIntervalMs = Number(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const specStreamTimeoutMs = Number(
    options.specStreamTimeoutMs
      ?? process.env.AURA_BENCH_PREFLIGHT_SPEC_TIMEOUT_MS
      ?? DEFAULT_SPEC_STREAM_TIMEOUT_MS,
  );
  const fixtureProfile = fixtureProfileLabel(options.fixtureProfile);
  const requireLoopDone = Boolean(options.requireLoopDone);

  const { fixtureDir, ephemeral } = await ensureFixtureDir(options.fixtureDir, fixtureProfile);

  const startedAt = Date.now();
  const ids = {
    orgId: null,
    integrationId: null,
    agentId: null,
    projectId: null,
    agentInstanceId: null,
  };
  let requestContractSummary = summarizeRequestContractReports([]);

  emit(onStep, {
    step: "preflight_start",
    status: "ok",
    elapsedMs: 0,
    details: {
      fixtureDir,
      ephemeral,
      fixtureProfile,
      loopTimeoutMs,
      specStreamTimeoutMs,
      requireLoopDone,
    },
  });

  try {
    await timedStep(onStep, "init_fixture_repo", async () => {
      const { initialized } = await ensureWorkspaceIsGitRepo(fixtureDir);
      return { detailsForLog: { initialized } };
    });

    await timedStep(onStep, "auth_session", async () => {
      const session = await client.apiJson("GET", "/api/auth/session");
      if (!session) {
        throw new StepFailure("auth_session", "session response was empty");
      }
      return { detailsForLog: { hasUser: Boolean(session?.user || session?.user_id) } };
    });

    await timedStep(onStep, "auth_import_token", async () => {
      await client.ensureImportedAccessToken();
      return { detailsForLog: null };
    });

    const orgs = await timedStep(onStep, "list_orgs", async () => {
      const list = await client.apiJson("GET", "/api/orgs");
      if (!Array.isArray(list)) {
        throw new StepFailure("list_orgs", "GET /api/orgs did not return an array");
      }
      return { value: list, detailsForLog: { orgCount: list.length } };
    });

    const orgRecord = await timedStep(onStep, "resolve_org", async () => {
      const existing = orgs.value.find((org) => org.name === orgName);
      if (existing) {
        ids.orgId = existing.org_id;
        return {
          value: { ...existing, created: false },
          detailsForLog: { orgId: existing.org_id, created: false },
        };
      }
      const created = await client.apiJson("POST", "/api/orgs", { name: orgName });
      if (!created?.org_id) {
        throw new StepFailure("resolve_org", "POST /api/orgs returned no org_id");
      }
      ids.orgId = created.org_id;
      return {
        value: { ...created, created: true },
        detailsForLog: { orgId: created.org_id, created: true },
      };
    });

    const runtimeConfig = resolveRuntimeConfig();

    if (runtimeConfig.authSource === "org_integration" && runtimeConfig.integrationProvider) {
      await timedStep(onStep, "create_integration", async () => {
        const integration = await client.apiJson(
          "POST",
          `/api/orgs/${orgRecord.value.org_id}/integrations`,
          {
            name:
              runtimeConfig.integrationName
              || `${runtimeConfig.adapterType}-${runtimeConfig.integrationProvider}-preflight`,
            provider: runtimeConfig.integrationProvider,
            default_model: runtimeConfig.defaultModel || null,
            api_key: runtimeConfig.apiKey || null,
          },
        );
        ids.integrationId = integration?.integration_id ?? null;
        return {
          detailsForLog: {
            integrationId: ids.integrationId,
            provider: runtimeConfig.integrationProvider,
          },
        };
      });
    }

    const agent = await timedStep(onStep, "create_agent", async () => {
      const created = await client.apiJson("POST", "/api/agents", {
        org_id: orgRecord.value.org_id,
        name: "Aura-Preflight",
        role: "Engineer",
        personality: "Methodical, careful, preflight-only.",
        system_prompt: [
          "You are AURA running a fast preflight task. Make the smallest possible change to satisfy requirements.md.",
          "",
          "Completion contract: when a task is verification-only and your work intentionally produces no file edits (for example, \"confirm no other files were modified\"), you MUST call `task_done` with `no_changes_needed: true`. Otherwise the dev-loop completion gate rejects `task_done` because there are no file operations to verify.",
        ].join("\n"),
        machine_type: runtimeConfig.machineType,
        adapter_type: runtimeConfig.adapterType,
        environment: runtimeConfig.environment,
        auth_source: runtimeConfig.authSource,
        integration_id:
          runtimeConfig.authSource === "org_integration" ? ids.integrationId : null,
        default_model: runtimeConfig.defaultModel || null,
        skills: [],
        icon: null,
        permissions: fullAccessPermissions(),
      });
      if (!created?.agent_id) {
        throw new StepFailure("create_agent", "POST /api/agents returned no agent_id");
      }
      ids.agentId = created.agent_id;
      return { value: created, detailsForLog: { agentId: created.agent_id } };
    });

    const project = await timedStep(onStep, "create_project", async () => {
      const created = await client.apiJson("POST", "/api/projects", {
        org_id: orgRecord.value.org_id,
        name: `Aura Preflight ${Date.now()}`,
        description: "Live preflight project (auto-cleanup).",
        // Use `node --version` (a single bare flag, no embedded
        // strings) for both gates so the preflight survives Windows'
        // argv parsing.
        //
        // Why not `node -e "..."` like the fixture's package.json
        // scripts? The harness build/test runner takes the configured
        // command and `split_whitespace`s it before
        // `Command::new(parts[0]).args(&parts[1..])` — there's no
        // shell to honour quote groups. A script with spaces inside
        // the quoted body (e.g. `node -e "console.log('preflight build
        // ok')"`) gets sliced into ["node","-e","\"console.log('preflight",
        // "build","ok')\""] and node receives an unterminated string
        // literal. Single-token args dodge the issue entirely.
        //
        // Why not `npm run build` / `npm run test`? Rust's
        // `Command::new("npm")` on Windows ignores `PATHEXT` so the
        // `.cmd` shim that ships with Node never resolves, and the
        // gate reports `program not found`. The proper fix lives in
        // the harness (see `aura-harness/crates/aura-agent/src/verify/
        // runner.rs` — `windows_resolve_program` resolves `PATHEXT`
        // before spawning); pinning the preflight commands to `node`
        // directly here keeps the fast sanity check green even on a
        // host where the harness binary hasn't been rebuilt yet,
        // because Rust's bare-name PATH search *does* find `node.exe`.
        //
        // The fixture's package.json keeps its `node -e
        // "console.log(...)"` scripts intact so the agent can still
        // demonstrate `npm run build` / `npm run test` via
        // `run_command` once the harness PATHEXT fix is live; only
        // the project record commands (which the harness invokes
        // directly) are pinned to portable single-token form.
        build_command: "node --version",
        test_command: "node --version",
        local_workspace_path: fixtureDir,
      });
      if (!created?.project_id) {
        throw new StepFailure(
          "create_project",
          "POST /api/projects returned no project_id",
        );
      }
      ids.projectId = created.project_id;
      return { value: created, detailsForLog: { projectId: created.project_id } };
    });

    const agentInstance = await timedStep(onStep, "attach_agent_instance", async () => {
      const created = await client.apiJson(
        "POST",
        `/api/projects/${project.value.project_id}/agents`,
        { agent_id: agent.value.agent_id },
      );
      if (!created?.agent_instance_id) {
        throw new StepFailure(
          "attach_agent_instance",
          "POST /api/projects/:id/agents returned no agent_instance_id",
        );
      }
      ids.agentInstanceId = created.agent_instance_id;
      return {
        value: created,
        detailsForLog: { agentInstanceId: created.agent_instance_id },
      };
    });

    await timedStep(onStep, "spec_stream", async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), specStreamTimeoutMs);
      let response;
      try {
        response = await fetch(
          `${client.apiBaseUrl}/api/projects/${project.value.project_id}`
            + `/agents/${agentInstance.value.agent_instance_id}/events/stream`,
          {
            method: "POST",
            headers: authHeaders(client.accessToken, {
              Accept: "text/event-stream",
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              content: "Generate specs for this project",
              action: "generate_specs",
            }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        clearTimeout(timer);
        const message = error instanceof Error ? error.message : String(error);
        throw new StepFailure(
          "spec_stream",
          `POST /events/stream transport failure: ${message}`,
        );
      }
      if (!response.ok) {
        clearTimeout(timer);
        const body = await response.text().catch(() => "");
        throw new StepFailure(
          "spec_stream",
          `HTTP ${response.status}: ${body.slice(0, 240)}`,
          { hint: response.status === 403
              ? "router/proxy auth likely rejected the chat path; verify aura-router cookie/secret"
              : undefined },
        );
      }
      let streamError = null;
      try {
        for await (const { eventType, data } of sseEvents(response)) {
          if (eventType === "assistant_message_end") break;
          if (eventType === "error") {
            streamError = typeof data?.message === "string" && data.message.length > 0
              ? data.message
              : "spec stream error";
            break;
          }
        }
      } finally {
        clearTimeout(timer);
      }
      if (streamError) {
        throw new StepFailure("spec_stream", streamError);
      }
      return { detailsForLog: null };
    });

    const specs = await timedStep(onStep, "list_specs", async () => {
      const list = await client.apiJson(
        "GET",
        `/api/projects/${project.value.project_id}/specs`,
      );
      const safe = Array.isArray(list) ? list : [];
      if (safe.length === 0) {
        throw new StepFailure(
          "list_specs",
          "spec stream completed but /api/projects/:id/specs returned 0 specs",
        );
      }
      return { value: safe, detailsForLog: { specCount: safe.length } };
    });

    void specs;

    const tasks = await timedStep(onStep, "extract_tasks", async () => {
      const extracted = await client.apiJson(
        "POST",
        `/api/projects/${project.value.project_id}/tasks/extract`
          + `?agent_instance_id=${agentInstance.value.agent_instance_id}`,
      );
      const safe = Array.isArray(extracted) ? extracted : [];
      if (safe.length === 0) {
        throw new StepFailure(
          "extract_tasks",
          "tasks/extract returned 0 tasks; the LLM router/model is likely unhealthy",
        );
      }
      return { value: safe, detailsForLog: { taskCount: safe.length } };
    });

    void tasks;

    await timedStep(onStep, "loop_start", async () => {
      await client.apiJson(
        "POST",
        `/api/projects/${project.value.project_id}/loop/start`
          + `?agent_instance_id=${agentInstance.value.agent_instance_id}`,
      );
      return { detailsForLog: null };
    });

    const loopOutcome = await timedStep(onStep, "loop_progress", async () => {
      const deadline = Date.now() + loopTimeoutMs;
      let lastSeen = null;
      while (Date.now() < deadline) {
        const latest = await client.apiJson(
          "GET",
          `/api/projects/${project.value.project_id}/tasks`,
        );
        lastSeen = Array.isArray(latest) ? latest : [];
        const allTerminal = lastSeen.length > 0 && lastSeen.every((task) =>
          ["done", "failed", "blocked"].includes(String(task?.status ?? "").toLowerCase()),
        );
        if (allTerminal) {
          const statuses = lastSeen.map((t) => String(t?.status ?? "").toLowerCase());
          if (requireLoopDone && statuses.some((status) => status !== "done")) {
            throw new StepFailure(
              "loop_progress",
              "phase 0 mock automation reached a non-done terminal state",
              {
                statuses,
                hint: "a failed/blocked task here indicates the autonomous loop failed before completing the controlled mock task",
              },
            );
          }
          return {
            value: lastSeen,
            detailsForLog: {
              taskCount: lastSeen.length,
              statuses: lastSeen.map((t) => t.status),
            },
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      throw new StepFailure(
        "loop_progress",
        `not all tasks reached a terminal state within ${loopTimeoutMs}ms`,
        {
          hint: "check the harness adapter logs (AURA_STACK_LOG_DIR/harness.log)",
          lastStatuses: (lastSeen ?? []).map((t) => t?.status),
        },
      );
    });

    void loopOutcome;

    await timedStep(onStep, "stats_and_sessions", async () => {
      const [stats, sessions] = await Promise.all([
        client.apiJson("GET", `/api/projects/${project.value.project_id}/stats`),
        client.apiJson(
          "GET",
          `/api/projects/${project.value.project_id}`
            + `/agents/${agentInstance.value.agent_instance_id}/sessions`,
        ),
      ]);
      const sessionList = Array.isArray(sessions) ? sessions : [];
      requestContractSummary = requestContractSummaryFromPreflightSurfaces(stats, sessionList);
      return {
        detailsForLog: {
          totalTokens: Number(stats?.total_tokens ?? 0),
          sessionCount: sessionList.length,
          requestContractAcceptance: requestContractSummary.acceptance,
          requestContractVerdicts: requestContractSummary.verdict_counts,
        },
      };
    });

    const totalElapsedMs = Date.now() - startedAt;
    emit(onStep, {
      step: "preflight_complete",
      status: "ok",
      elapsedMs: totalElapsedMs,
      details: {
        fixtureDir,
        ephemeral,
        requestContractAcceptance: requestContractSummary.acceptance,
        requestContract: requestContractSummary,
        requestContractSummary: describeRequestContractSummary(requestContractSummary),
      },
    });
    return { ok: true, totalElapsedMs, requestContract: requestContractSummary };
  } finally {
    await cleanupCreatedEntities(client, ids, onStep);
    if (ephemeral) {
      await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
