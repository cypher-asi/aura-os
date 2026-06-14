#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  latestInvestigationsByCheck,
  investigationKey,
} from "./lib/status-investigations.mjs";
import { buildInvestigationVerifierContext } from "./lib/status-investigation-verifiers.mjs";
import {
  buildSkippedLearningPayload,
  extractLessons,
} from "./lib/status-lessons.mjs";
import {
  callAnthropicTool,
  callOpenAiCompatibleJson,
} from "./lib/status-llm-client.mjs";
import { normalizeCheckResult } from "./lib/status-policy.mjs";
import { normalizeRepair } from "./lib/status-repairer.mjs";
import { discoverInvestigationSources } from "./lib/status-source-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "..", "..", "..");
const ANTHROPIC_LEARNING_TOOL = Object.freeze({
  name: "record_observability_lessons",
  description: "Record durable AURA observability learning notes.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["lessons"],
    properties: {
      lessons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "category",
            "confidence",
            "summary",
            "evidence",
            "appliesTo",
            "recommendedActions",
            "followUpEvals",
            "sourceDiscoveryHints",
            "repairPlaybookNotes",
            "promptGuardrails",
          ],
          properties: {
            title: { type: "string" },
            category: {
              type: "string",
              enum: [
                "eval-coverage",
                "source-discovery",
                "repair-playbook",
                "prompt-guardrail",
                "workflow-reliability",
                "product-risk",
              ],
            },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            summary: { type: "string" },
            evidence: { type: "array", minItems: 1, items: { type: "string" } },
            appliesTo: { type: "array", items: { type: "string" } },
            recommendedActions: { type: "array", items: { type: "string" } },
            followUpEvals: { type: "array", items: { type: "string" } },
            sourceDiscoveryHints: { type: "array", items: { type: "string" } },
            repairPlaybookNotes: { type: "array", items: { type: "string" } },
            promptGuardrails: { type: "array", items: { type: "string" } },
            expiresWhen: { type: "string" },
          },
        },
      },
    },
  },
});

function parseArgs(argv) {
  const repoRoot = path.resolve(process.env.AURA_STATUS_LEARNING_REPO_ROOT || defaultRepoRoot);
  const defaultProvider = process.env.AURA_STATUS_LEARNING_PROVIDER
    || (process.env.AURA_STATUS_LEARNING_BASE_URL ? "openai-compatible" : "")
    || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai-compatible");
  const args = {
    repoRoot,
    checksDir: process.env.AURA_STATUS_CHECKS_DIR || "infra/evals/reports/status/checks",
    checksFile: process.env.AURA_STATUS_CHECKS_FILE || "",
    investigationsDir: process.env.AURA_STATUS_INVESTIGATIONS_DIR || "infra/evals/reports/status/investigations",
    investigationsFile: process.env.AURA_STATUS_INVESTIGATIONS_FILE || "",
    repairsDir: process.env.AURA_STATUS_REPAIRS_DIR || "infra/evals/reports/status/repairs",
    repairsFile: process.env.AURA_STATUS_REPAIRS_FILE || "",
    repairDispatchPlanFile: process.env.AURA_STATUS_REPAIR_DISPATCH_PLAN_FILE || "",
    registry: process.env.AURA_STATUS_FEATURES_FILE || "infra/evals/status/features.json",
    expectationsFile: process.env.AURA_STATUS_EXPECTATIONS_FILE || "infra/evals/status/check-expectations.json",
    runner: process.env.AURA_STATUS_PROBES_FILE || "infra/evals/status/run-status-probes.mjs",
    outDir: process.env.AURA_STATUS_LESSONS_DIR || "infra/evals/reports/status/lessons",
    outFile: process.env.AURA_STATUS_LESSONS_FILE || "",
    environment: process.env.AURA_STATUS_ENVIRONMENT || "unknown",
    source: process.env.AURA_STATUS_SOURCE || "aura-status-learning",
    provider: defaultProvider,
    baseUrl: process.env.AURA_STATUS_LEARNING_BASE_URL || process.env.AURA_STATUS_INVESTIGATOR_BASE_URL || "",
    apiKey: process.env.AURA_STATUS_LEARNING_API_KEY || process.env.AURA_STATUS_INVESTIGATOR_API_KEY || "",
    model: process.env.AURA_STATUS_LEARNING_MODEL || process.env.AURA_STATUS_INVESTIGATOR_MODEL || "",
    timeoutMs: Number(process.env.AURA_STATUS_LEARNING_TIMEOUT_MS || 90_000),
    maxTokens: Number(process.env.AURA_STATUS_LEARNING_MAX_TOKENS || 4_000),
    maxCases: Number(process.env.AURA_STATUS_LEARNING_MAX_CASES || 8),
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
    else if (arg === "--repairs-dir") args.repairsDir = path.resolve(next());
    else if (arg === "--repairs-file") args.repairsFile = path.resolve(next());
    else if (arg === "--repair-dispatch-plan") args.repairDispatchPlanFile = path.resolve(next());
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
    else if (arg === "--max-cases") args.maxCases = Number(next());
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/run-status-learning.mjs [--repo-root DIR] [--checks-dir DIR] [--investigations-dir DIR] [--repairs-dir DIR] [--out-dir DIR]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 90_000;
  if (!Number.isFinite(args.maxTokens) || args.maxTokens <= 0) args.maxTokens = 4_000;
  if (!Number.isFinite(args.maxCases) || args.maxCases <= 0) args.maxCases = 8;
  if (args.provider === "anthropic") {
    args.baseUrl = args.baseUrl || "https://api.anthropic.com/v1";
    args.apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY || "";
  }
  args.checksFile = resolveFromRepo(args.repoRoot, args.checksFile);
  args.investigationsFile = resolveFromRepo(args.repoRoot, args.investigationsFile);
  args.repairsFile = resolveFromRepo(args.repoRoot, args.repairsFile);
  args.repairDispatchPlanFile = resolveFromRepo(args.repoRoot, args.repairDispatchPlanFile);
  args.registry = resolveFromRepo(args.repoRoot, args.registry);
  args.expectationsFile = resolveFromRepo(args.repoRoot, args.expectationsFile);
  args.runner = resolveFromRepo(args.repoRoot, args.runner);
  args.checksDir = resolveFromRepo(args.repoRoot, args.checksDir);
  args.investigationsDir = resolveFromRepo(args.repoRoot, args.investigationsDir);
  args.repairsDir = resolveFromRepo(args.repoRoot, args.repairsDir);
  args.outDir = resolveFromRepo(args.repoRoot, args.outDir);
  args.outFile = resolveFromRepo(args.repoRoot, args.outFile);
  if (!args.outFile) args.outFile = path.join(args.outDir, "lessons.json");
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
  if (args.checksFile) return checksFromPayload(await readJson(args.checksFile), generatedAt);
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
  if (args.investigationsFile) return investigationsFromPayload(await readJson(args.investigationsFile), generatedAt);
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

async function readRepairs(args, generatedAt) {
  const repairs = [];
  if (args.repairsFile) return repairsFromPayload(await readJson(args.repairsFile), generatedAt);
  for (const file of await walkJsonFiles(args.repairsDir)) {
    try {
      repairs.push(...repairsFromPayload(await readJson(file), generatedAt));
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return repairs;
}

function repairsFromPayload(payload, generatedAt) {
  const rawRepairs = Array.isArray(payload) ? payload : Array.isArray(payload?.repairs) ? payload.repairs : payload?.checkId ? [payload] : [];
  return rawRepairs.map((repair) => normalizeRepair(repair, generatedAt)).filter(Boolean);
}

async function readOptionalJson(filePath) {
  if (!filePath) return null;
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function latestRepairsByCheck(repairs) {
  const map = new Map();
  for (const repair of repairs) {
    const key = investigationKey(repair.featureId, repair.checkId);
    const existing = map.get(key) ?? map.get(investigationKey(null, repair.checkId));
    if (!existing || new Date(repair.generatedAt ?? 0).getTime() > new Date(existing.generatedAt ?? 0).getTime()) {
      map.set(key, repair);
      map.set(investigationKey(null, repair.checkId), repair);
    }
  }
  return map;
}

function findFeature(registry, check) {
  return (registry.features ?? []).find((feature) => feature.id === check.featureId)
    ?? (registry.features ?? []).find((feature) => (feature.checks ?? []).some((config) => config.id === check.checkId))
    ?? null;
}

function findCheckConfig(feature, checkId) {
  return (feature?.checks ?? []).find((config) => config.id === checkId) ?? null;
}

function shouldLearnFromCheck(check) {
  return check?.status === "fail" || check?.status === "warn";
}

function hasConfiguredModel(args) {
  if (args.provider === "anthropic") return Boolean(args.apiKey && args.model);
  return Boolean(args.baseUrl && args.apiKey && args.model);
}

function callLearningModel(args, request) {
  if (args.provider === "anthropic") {
    return callAnthropicTool({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      model: args.model,
      messages: request.messages,
      timeoutMs: args.timeoutMs,
      maxTokens: args.maxTokens,
      tool: ANTHROPIC_LEARNING_TOOL,
      requestLabel: "Anthropic learning",
    });
  }
  return callOpenAiCompatibleJson({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    messages: request.messages,
    timeoutMs: args.timeoutMs,
    requestLabel: "Learning",
  });
}

async function buildLearningCases({
  args,
  checks,
  checkRecords,
  registry,
  expectations,
  investigationMap,
  repairMap,
}) {
  const cases = [];
  for (const check of checks.filter(shouldLearnFromCheck).slice(0, args.maxCases)) {
    const feature = findFeature(registry, check);
    const checkConfig = findCheckConfig(feature, check.checkId);
    const expectation = expectations.checks?.[check.checkId] ?? null;
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
    const investigation = investigationMap.get(investigationKey(check.featureId, check.checkId))
      ?? investigationMap.get(investigationKey(null, check.checkId))
      ?? null;
    const repair = repairMap.get(investigationKey(check.featureId, check.checkId))
      ?? repairMap.get(investigationKey(null, check.checkId))
      ?? null;
    cases.push({
      check,
      feature: feature ? {
        id: feature.id,
        label: feature.label,
        category: feature.category,
        description: feature.description,
      } : null,
      checkConfig,
      expectation,
      investigation,
      repair,
      verifierContext,
      sourceDiscovery,
    });
  }
  return cases;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const registry = await readJson(args.registry);
  const expectations = await readJson(args.expectationsFile);
  const checkRecords = await readCheckRecords(args, generatedAt);
  const checks = latestByCheckId(checkRecords, generatedAt);
  const investigations = await readInvestigations(args, generatedAt);
  const repairs = await readRepairs(args, generatedAt);
  const learningCases = await buildLearningCases({
    args,
    checks,
    checkRecords,
    registry,
    expectations,
    investigationMap: latestInvestigationsByCheck(investigations, generatedAt),
    repairMap: latestRepairsByCheck(repairs),
  });
  const repairDispatchPlan = await readOptionalJson(args.repairDispatchPlanFile);

  let payload;
  if (learningCases.length === 0) {
    payload = {
      schemaVersion: 1,
      kind: "llm-observability-lessons",
      status: "ready",
      generatedAt,
      environment: args.environment,
      source: args.source,
      provider: args.provider,
      model: args.model || null,
      lessons: [],
    };
  } else if (!hasConfiguredModel(args)) {
    payload = buildSkippedLearningPayload({
      generatedAt,
      environment: args.environment,
      source: args.source,
      provider: args.provider,
      model: args.model || null,
      reason: "No learning model configured.",
    });
  } else {
    payload = await extractLessons({
      checks,
      investigations,
      repairs,
      learningCases,
      repairDispatchPlan,
      generatedAt,
      environment: args.environment,
      source: args.source,
      provider: args.provider,
      model: args.model,
      callModel: (request) => callLearningModel(args, request),
    });
  }

  await writeJson(args.outFile, payload);
  process.stdout.write(`Wrote ${payload.lessons.length} observability lesson(s) to ${path.relative(args.repoRoot, args.outFile)}\n`);
}

await main();

function resolveFromRepo(repoRoot, maybePath) {
  if (!maybePath) return maybePath;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(repoRoot, maybePath);
}
