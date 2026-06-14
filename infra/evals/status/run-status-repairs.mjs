#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { normalizeCheckResult } from "./lib/status-policy.mjs";
import {
  latestInvestigationsByCheck,
  investigationKey,
  INVESTIGATION_STATUS,
} from "./lib/status-investigations.mjs";
import { buildInvestigationVerifierContext } from "./lib/status-investigation-verifiers.mjs";
import {
  callAnthropicTool,
  callOpenAiCompatibleJson,
} from "./lib/status-llm-client.mjs";
import { discoverInvestigationSources } from "./lib/status-source-discovery.mjs";
import {
  pathsFromUnifiedDiff,
  proposeRepair,
  REPAIR_STATUS,
  meetsRepairConfidence,
  validateUnifiedDiff,
} from "./lib/status-repairer.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "..", "..", "..");
const ANTHROPIC_REPAIR_TOOL = Object.freeze({
  name: "record_repair_proposal",
  description: "Record a gated AURA observability repair proposal.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "repairable",
      "title",
      "confidence",
      "summary",
      "rootCause",
      "proof",
      "changePlan",
      "targetFiles",
      "unifiedDiff",
      "verificationCommands",
      "risks",
      "requiresHumanReview",
      "followUpEvals",
    ],
    properties: {
      repairable: { type: "boolean" },
      title: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      summary: { type: "string" },
      rootCause: { type: "string" },
      proof: { type: "array", items: { type: "string" } },
      changePlan: { type: "array", items: { type: "string" } },
      targetFiles: { type: "array", items: { type: "string" } },
      unifiedDiff: { type: "string" },
      verificationCommands: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      requiresHumanReview: { type: "boolean" },
      followUpEvals: { type: "array", items: { type: "string" } },
    },
  },
});

function parseArgs(argv) {
  const repoRoot = path.resolve(process.env.AURA_STATUS_REPAIR_REPO_ROOT || defaultRepoRoot);
  const defaultProvider = process.env.AURA_STATUS_REPAIR_PROVIDER
    || (process.env.AURA_STATUS_REPAIR_BASE_URL ? "openai-compatible" : "")
    || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai-compatible");
  const args = {
    repoRoot,
    checksDir: process.env.AURA_STATUS_CHECKS_DIR || path.join(repoRoot, "infra/evals/reports/status/checks"),
    checksFile: process.env.AURA_STATUS_CHECKS_FILE || "",
    investigationsDir: process.env.AURA_STATUS_INVESTIGATIONS_DIR || path.join(repoRoot, "infra/evals/reports/status/investigations"),
    investigationsFile: process.env.AURA_STATUS_INVESTIGATIONS_FILE || "",
    registry: process.env.AURA_STATUS_FEATURES_FILE || path.join(__dirname, "features.json"),
    expectationsFile: process.env.AURA_STATUS_EXPECTATIONS_FILE || path.join(__dirname, "check-expectations.json"),
    runner: process.env.AURA_STATUS_PROBES_FILE || path.join(__dirname, "run-status-probes.mjs"),
    outDir: process.env.AURA_STATUS_REPAIRS_DIR || path.join(repoRoot, "infra/evals/reports/status/repairs"),
    outFile: process.env.AURA_STATUS_REPAIRS_FILE || "",
    environment: process.env.AURA_STATUS_ENVIRONMENT || "unknown",
    source: process.env.AURA_STATUS_SOURCE || "aura-status-repair",
    provider: defaultProvider,
    baseUrl: process.env.AURA_STATUS_REPAIR_BASE_URL || process.env.AURA_STATUS_INVESTIGATOR_BASE_URL || "",
    apiKey: process.env.AURA_STATUS_REPAIR_API_KEY || process.env.AURA_STATUS_INVESTIGATOR_API_KEY || "",
    model: process.env.AURA_STATUS_REPAIR_MODEL || process.env.AURA_STATUS_INVESTIGATOR_MODEL || "",
    timeoutMs: Number(process.env.AURA_STATUS_REPAIR_TIMEOUT_MS || 120_000),
    maxTokens: Number(process.env.AURA_STATUS_REPAIR_MAX_TOKENS || 8_000),
    maxRepairs: Number(process.env.AURA_STATUS_REPAIR_MAX_CHECKS || 1),
    maxPatchFiles: Number(process.env.AURA_STATUS_REPAIR_MAX_PATCH_FILES || 6),
    maxPatchLines: Number(process.env.AURA_STATUS_REPAIR_MAX_PATCH_LINES || 600),
    apply: process.env.AURA_STATUS_REPAIR_APPLY === "1",
    commit: process.env.AURA_STATUS_REPAIR_COMMIT !== "0",
    createPr: process.env.AURA_STATUS_REPAIR_CREATE_PR === "1",
    runVerification: process.env.AURA_STATUS_REPAIR_RUN_VERIFICATION === "1",
    allowDirty: process.env.AURA_STATUS_REPAIR_ALLOW_DIRTY === "1",
    minConfidence: process.env.AURA_STATUS_REPAIR_MIN_CONFIDENCE || "medium",
    branch: process.env.AURA_STATUS_REPAIR_BRANCH || "",
    prBase: process.env.AURA_STATUS_REPAIR_PR_BASE || "main",
    prTitle: process.env.AURA_STATUS_REPAIR_PR_TITLE || "",
    allowedPathPrefixes: splitCsv(process.env.AURA_STATUS_REPAIR_ALLOWED_PATH_PREFIXES || ""),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--repo-root") args.repoRoot = path.resolve(next());
    else if (arg === "--checks-dir") args.checksDir = path.resolve(next());
    else if (arg === "--checks-file") args.checksFile = path.resolve(next());
    else if (arg === "--investigations-dir") args.investigationsDir = path.resolve(next());
    else if (arg === "--investigations-file") args.investigationsFile = path.resolve(next());
    else if (arg === "--registry") args.registry = path.resolve(next());
    else if (arg === "--expectations") args.expectationsFile = path.resolve(next());
    else if (arg === "--runner") args.runner = path.resolve(next());
    else if (arg === "--out-dir") args.outDir = path.resolve(next());
    else if (arg === "--out-file") args.outFile = path.resolve(next());
    else if (arg === "--environment") args.environment = next();
    else if (arg === "--source") args.source = next();
    else if (arg === "--provider") args.provider = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--api-key") args.apiKey = next();
    else if (arg === "--model") args.model = next();
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next());
    else if (arg === "--max-repairs") args.maxRepairs = Number(next());
    else if (arg === "--max-patch-files") args.maxPatchFiles = Number(next());
    else if (arg === "--max-patch-lines") args.maxPatchLines = Number(next());
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--commit") args.commit = true;
    else if (arg === "--no-commit") args.commit = false;
    else if (arg === "--create-pr") args.createPr = true;
    else if (arg === "--run-verification") args.runVerification = true;
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else if (arg === "--min-confidence") args.minConfidence = next();
    else if (arg === "--branch") args.branch = next();
    else if (arg === "--pr-base") args.prBase = next();
    else if (arg === "--pr-title") args.prTitle = next();
    else if (arg === "--allowed-path-prefixes") args.allowedPathPrefixes = splitCsv(next());
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/run-status-repairs.mjs [--checks-dir DIR] [--investigations-dir DIR] [--apply] [--create-pr]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 120_000;
  if (!Number.isFinite(args.maxTokens) || args.maxTokens <= 0) args.maxTokens = 8_000;
  if (!Number.isFinite(args.maxRepairs) || args.maxRepairs <= 0) args.maxRepairs = 1;
  if (!Number.isFinite(args.maxPatchFiles) || args.maxPatchFiles <= 0) args.maxPatchFiles = 6;
  if (!Number.isFinite(args.maxPatchLines) || args.maxPatchLines <= 0) args.maxPatchLines = 600;
  if (args.provider === "anthropic") {
    args.baseUrl = args.baseUrl || "https://api.anthropic.com/v1";
    args.apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY || "";
  }
  if (args.createPr && !args.apply) {
    throw new Error("--create-pr requires --apply so a committed repair branch exists.");
  }
  args.checksDir = resolveFromRepo(args.repoRoot, args.checksDir);
  args.investigationsDir = resolveFromRepo(args.repoRoot, args.investigationsDir);
  args.outDir = resolveFromRepo(args.repoRoot, args.outDir);
  if (!args.outFile) args.outFile = path.join(args.outDir, "repairs.json");
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function walkJsonFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
  }
  return files;
}

async function readCheckRecords(args, generatedAt) {
  if (args.checksFile) {
    const payload = await readJson(args.checksFile);
    return checksFromPayload(payload, generatedAt);
  }
  const checks = [];
  for (const file of await walkJsonFiles(args.checksDir)) {
    try {
      checks.push(...checksFromPayload(await readJson(file), generatedAt));
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return checks;
}

function checksFromPayload(payload, generatedAt) {
  const rawChecks = Array.isArray(payload) ? payload : Array.isArray(payload?.checks) ? payload.checks : payload?.checkId ? [payload] : [];
  return rawChecks.map((check) => normalizeCheckResult({
    ...check,
    runGeneratedAt: payload?.generatedAt ?? check.runGeneratedAt,
  }, generatedAt));
}

function latestByCheckId(checks, generatedAt) {
  const map = new Map();
  for (const check of checks) {
    if (!check.checkId) continue;
    const existing = map.get(check.checkId);
    const endedAt = new Date(check.endedAt ?? generatedAt).getTime();
    const existingEndedAt = new Date(existing?.endedAt ?? 0).getTime();
    if (!existing || endedAt > existingEndedAt) map.set(check.checkId, check);
  }
  return [...map.values()];
}

async function readInvestigations(args, generatedAt) {
  const investigations = [];
  if (args.investigationsFile) {
    investigations.push(...investigationsFromPayload(await readJson(args.investigationsFile), generatedAt));
    return investigations;
  }
  for (const file of await walkJsonFiles(args.investigationsDir)) {
    try {
      investigations.push(...investigationsFromPayload(await readJson(file), generatedAt));
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return investigations;
}

function investigationsFromPayload(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.investigations) ? payload.investigations : payload?.checkId ? [payload] : [];
}

function findFeature(registry, check) {
  return (registry.features ?? []).find((feature) => feature.id === check.featureId)
    ?? (registry.features ?? []).find((feature) => (feature.checks ?? []).some((config) => config.id === check.checkId))
    ?? null;
}

function findCheckConfig(feature, checkId) {
  return (feature?.checks ?? []).find((config) => config.id === checkId) ?? null;
}

function needsRepair(check) {
  return check?.status === "fail" || check?.status === "warn";
}

function hasConfiguredModel(args) {
  if (args.provider === "anthropic") return Boolean(args.apiKey && args.model);
  return Boolean(args.baseUrl && args.apiKey && args.model);
}

function callRepairModel(args, request) {
  if (args.provider === "anthropic") {
    return callAnthropicTool({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      model: args.model,
      messages: request.messages,
      timeoutMs: args.timeoutMs,
      maxTokens: args.maxTokens,
      tool: ANTHROPIC_REPAIR_TOOL,
      requestLabel: "Anthropic repair",
    });
  }
  return callOpenAiCompatibleJson({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    messages: request.messages,
    timeoutMs: args.timeoutMs,
    requestLabel: "Repair",
  });
}

async function applyRepair(args, repair) {
  if (!repair.repairable) return repair;
  if (!meetsRepairConfidence(repair, args.minConfidence)) {
    return {
      ...repair,
      status: REPAIR_STATUS.SKIPPED,
      error: `Repair confidence ${repair.confidence} is below required ${args.minConfidence}.`,
    };
  }
  if (args.createPr) {
    const existingPrUrl = await findExistingRepairPullRequest(args, repair);
    if (existingPrUrl) {
      return {
        ...repair,
        status: REPAIR_STATUS.SKIPPED,
        error: `Open repair PR already exists for ${repair.checkId}: ${existingPrUrl}`,
        apply: { prUrl: existingPrUrl },
      };
    }
  }
  const patchIssues = validateUnifiedDiff(repair.unifiedDiff, {
    repoRoot: args.repoRoot,
    allowedPathPrefixes: args.allowedPathPrefixes,
  });
  if (patchIssues.length > 0) {
    return {
      ...repair,
      status: REPAIR_STATUS.FAILED,
      error: `Patch rejected: ${patchIssues.join("; ")}`,
    };
  }

  if (!args.allowDirty) await assertCleanWorktree(args.repoRoot);
  if (args.branch) await execGit(args.repoRoot, ["checkout", "-B", args.branch]);

  const patchPaths = pathsFromUnifiedDiff(repair.unifiedDiff);
  if (patchPaths.length > args.maxPatchFiles) {
    return {
      ...repair,
      status: REPAIR_STATUS.FAILED,
      error: `Patch edits ${patchPaths.length} files, above limit ${args.maxPatchFiles}.`,
    };
  }
  const patchLineCount = repair.unifiedDiff.split("\n").length;
  if (patchLineCount > args.maxPatchLines) {
    return {
      ...repair,
      status: REPAIR_STATUS.FAILED,
      error: `Patch has ${patchLineCount} lines, above limit ${args.maxPatchLines}.`,
    };
  }
  const undeclaredPaths = patchPaths.filter((filePath) => !repair.targetFiles.includes(filePath));
  if (undeclaredPaths.length > 0) {
    return {
      ...repair,
      status: REPAIR_STATUS.FAILED,
      error: `Patch edits undeclared target file(s): ${undeclaredPaths.join(", ")}`,
    };
  }
  if (args.runVerification && !hasRequiredFailingCheckVerifier(repair)) {
    return {
      ...repair,
      status: REPAIR_STATUS.FAILED,
      error: `Verification commands must include AURA_STATUS_CHECKS=${repair.checkId} npm run status:probes.`,
    };
  }

  await execGit(args.repoRoot, ["apply", "--check", "-"], repair.unifiedDiff);
  await execGit(args.repoRoot, ["apply", "-"], repair.unifiedDiff);

  const verificationResults = args.runVerification ? await runVerificationCommands(args, repair) : [];
  let commitSha = null;
  if (args.commit) {
    await execGit(args.repoRoot, ["add", ...patchPaths]);
    await execGit(args.repoRoot, ["commit", "-m", commitMessage(repair)]);
    commitSha = (await execGit(args.repoRoot, ["rev-parse", "HEAD"])).stdout.trim();
  }

  let prUrl = null;
  if (args.createPr) {
    if (!args.commit) throw new Error("--create-pr requires committing the repair patch.");
    const branch = args.branch || (await execGit(args.repoRoot, ["branch", "--show-current"])).stdout.trim();
    await execGit(args.repoRoot, ["push", "-u", "origin", branch]);
    prUrl = await createPullRequest(args, repair, branch);
  }

  return {
    ...repair,
    status: REPAIR_STATUS.APPLIED,
    apply: {
      patchPaths,
      verificationResults,
      commitSha,
      prUrl,
    },
  };
}

async function assertCleanWorktree(repoRoot) {
  const { stdout } = await execGit(repoRoot, ["status", "--porcelain"]);
  const dirty = stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.slice(3).startsWith("infra/evals/reports/"));
  if (dirty.length > 0) {
    throw new Error(`Repair apply requires a clean worktree. Dirty paths: ${dirty.slice(0, 10).join(", ")}`);
  }
}

async function runVerificationCommands(args, repair) {
  const commands = repair.verificationCommands.filter(isAllowedVerificationCommand).slice(0, 5);
  const results = [];
  for (const command of commands) {
    const result = await runShell(command, args.repoRoot, args.timeoutMs);
    results.push({
      command,
      exitCode: result.code,
      stdout: result.stdout.slice(-4_000),
      stderr: result.stderr.slice(-4_000),
    });
    if (result.code !== 0) {
      throw new Error(`Verification command failed: ${command}\n${result.stderr || result.stdout}`);
    }
  }
  return results;
}

function isAllowedVerificationCommand(command) {
  return /^AURA_STATUS_CHECKS=[A-Za-z0-9_,:-]+ npm run status:probes$/.test(command)
    || command === "npm run status:probes"
    || command === "npm run status:investigate"
    || command === "npm run status:snapshot"
    || command === "node --test $(rg --files infra/evals/status | rg 'test\\.mjs$')"
    || /^node --test [A-Za-z0-9_./ -]+$/.test(command)
    || /^npm run test -- [A-Za-z0-9_./:-]+$/.test(command);
}

function hasRequiredFailingCheckVerifier(repair) {
  const expected = repair?.checkId ? `AURA_STATUS_CHECKS=${repair.checkId} npm run status:probes` : "npm run status:probes";
  return repair?.verificationCommands?.includes(expected);
}

function runShell(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function execGit(cwd, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`git ${args.join(" ")} failed with ${code}: ${stderr || stdout}`));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function createPullRequest(args, repair, branch) {
  const title = repairPrTitle(args, repair);
  const body = [
    "## Observability Repair",
    "",
    repair.summary,
    "",
    "## Evidence",
    ...repair.proof.map((item) => `- ${item}`),
    "",
    "## Verification",
    ...repair.verificationCommands.map((command) => `- \`${command}\``),
    "",
    "## Risk",
    ...repair.risks.map((risk) => `- ${risk}`),
  ].join("\n");
  const { stdout } = await execFileAsync("gh", [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--base",
    args.prBase,
    "--head",
    branch,
  ], { cwd: args.repoRoot, timeout: 30_000, maxBuffer: 64_000 });
  return stdout.trim().split("\n").at(-1) ?? "";
}

async function findExistingRepairPullRequest(args, repair) {
  const title = repairPrTitle(args, repair);
  try {
    const { stdout } = await execFileAsync("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--search",
      `"${title}" in:title`,
      "--json",
      "url,title",
      "--jq",
      ".[0].url // \"\"",
    ], { cwd: args.repoRoot, timeout: 30_000, maxBuffer: 64_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

function repairPrTitle(args, repair) {
  return args.prTitle || `Repair ${repair.checkId} observability failure`;
}

function commitMessage(repair) {
  return `fix(observability): repair ${repair.checkId}`;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function splitCsv(value) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function resolveFromRepo(repoRoot, maybePath) {
  if (!maybePath) return maybePath;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(repoRoot, maybePath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const registry = await readJson(args.registry);
  const expectations = await readJson(args.expectationsFile);
  const checkRecords = await readCheckRecords(args, generatedAt);
  const checks = latestByCheckId(checkRecords, generatedAt);
  const investigations = await readInvestigations(args, generatedAt);
  const investigationMap = latestInvestigationsByCheck(investigations, generatedAt);
  const failingChecks = checks.filter(needsRepair).filter((check) => {
    const key = investigationKey(check.featureId, check.checkId);
    const investigation = investigationMap.get(key) ?? investigationMap.get(investigationKey(null, check.checkId));
    return investigation?.status === INVESTIGATION_STATUS.READY;
  }).slice(0, args.maxRepairs);

  const payload = {
    schemaVersion: 1,
    generatedAt,
    environment: args.environment,
    source: args.source,
    provider: args.provider,
    model: args.model || null,
    applyMode: args.apply,
    repairs: [],
  };

  if (failingChecks.length === 0) {
    await writeJson(args.outFile, payload);
    process.stdout.write(`No investigated failing or warning checks to repair. Wrote ${path.relative(args.repoRoot, args.outFile)}\n`);
    return;
  }

  if (!hasConfiguredModel(args)) {
    await writeJson(args.outFile, payload);
    process.stdout.write(`No repair model configured; wrote empty repair set to ${path.relative(args.repoRoot, args.outFile)}\n`);
    return;
  }

  for (const check of failingChecks) {
    const feature = findFeature(registry, check);
    const checkConfig = findCheckConfig(feature, check.checkId);
    const expectation = expectations.checks?.[check.checkId] ?? null;
    const investigation = investigationMap.get(investigationKey(check.featureId, check.checkId))
      ?? investigationMap.get(investigationKey(null, check.checkId));
    const siblingChecks = checks.filter((candidate) => candidate.featureId === check.featureId && candidate.checkId !== check.checkId);
    const previousChecks = checkRecords
      .filter((candidate) =>
        candidate.checkId === check.checkId
          && candidate.endedAt
          && check.endedAt
          && new Date(candidate.endedAt).getTime() < new Date(check.endedAt).getTime(),
      );
    const { sourceHints, sourceContext, sourceDiscovery } = await discoverInvestigationSources({
      check,
      feature,
      checkConfig,
      expectation,
      previousChecks,
      registryPath: args.registry,
      expectationsPath: args.expectationsFile,
      runnerPath: args.runner,
      repoRoot: args.repoRoot,
    });
    const verifierContext = buildInvestigationVerifierContext({
      check,
      expectation,
      siblingChecks,
      previousChecks,
      sourceHints,
      sourceContext,
      sourceDiscovery,
    });
    let repair = await proposeRepair({
      check,
      feature,
      checkConfig,
      expectation,
      investigation,
      sourceHints,
      sourceContext,
      sourceDiscovery,
      verifierContext,
      generatedAt,
      environment: args.environment,
      source: args.source,
      provider: args.provider,
      model: args.model,
      callModel: (request) => callRepairModel(args, request),
    });
    if (args.apply && repair.repairable) {
      try {
        repair = await applyRepair(args, repair);
      } catch (error) {
        repair = {
          ...repair,
          status: REPAIR_STATUS.FAILED,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    payload.repairs.push(repair);
  }

  await writeJson(args.outFile, payload);
  const applied = payload.repairs.filter((repair) => repair.status === REPAIR_STATUS.APPLIED).length;
  process.stdout.write(`Wrote ${payload.repairs.length} repair proposal(s), applied ${applied}, to ${path.relative(args.repoRoot, args.outFile)}\n`);
}

await main();
