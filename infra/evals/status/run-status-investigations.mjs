#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { normalizeCheckResult } from "./lib/status-policy.mjs";
import {
  investigateCheck,
  needsInvestigation,
  sourceNeedlesForCheck,
} from "./lib/status-investigator.mjs";
import { buildInvestigationVerifierContext } from "./lib/status-investigation-verifiers.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const ANTHROPIC_INVESTIGATION_TOOL = Object.freeze({
  name: "record_investigation",
  description: "Record an evidence-backed AURA observability investigation report.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "confidence",
      "summary",
      "rootCause",
      "proof",
      "possibleCauses",
      "reproductionSteps",
      "affectedAreas",
      "whatWouldDisproveThis",
      "recommendedVerifierProbes",
      "recommendedNextActions",
      "followUpEvals",
    ],
    properties: {
      title: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      summary: { type: "string" },
      rootCause: { type: "string" },
      proof: { type: "array", minItems: 1, items: { type: "string" } },
      possibleCauses: { type: "array", minItems: 1, items: { type: "string" } },
      reproductionSteps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            label: { type: "string" },
            command: { type: "string" },
            details: { type: "string" },
          },
        },
      },
      affectedAreas: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            label: { type: "string" },
            path: { type: "string" },
            reason: { type: "string" },
            details: { type: "string" },
          },
        },
      },
      whatWouldDisproveThis: { type: "array", minItems: 1, items: { type: "string" } },
      recommendedVerifierProbes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            label: { type: "string" },
            command: { type: "string" },
            reason: { type: "string" },
            details: { type: "string" },
          },
        },
      },
      recommendedNextActions: { type: "array", minItems: 1, items: { type: "string" } },
      followUpEvals: { type: "array", items: { type: "string" } },
    },
  },
});

function parseArgs(argv) {
  const defaultProvider = process.env.AURA_STATUS_INVESTIGATOR_PROVIDER
    || (process.env.AURA_STATUS_INVESTIGATOR_BASE_URL ? "openai-compatible" : "")
    || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai-compatible");
  const args = {
    checksDir: process.env.AURA_STATUS_CHECKS_DIR || path.join(repoRoot, "infra/evals/reports/status/checks"),
    checksFile: process.env.AURA_STATUS_CHECKS_FILE || "",
    registry: process.env.AURA_STATUS_FEATURES_FILE || path.join(__dirname, "features.json"),
    expectationsFile: process.env.AURA_STATUS_EXPECTATIONS_FILE || path.join(__dirname, "check-expectations.json"),
    outDir: process.env.AURA_STATUS_INVESTIGATIONS_DIR || path.join(repoRoot, "infra/evals/reports/status/investigations"),
    outFile: process.env.AURA_STATUS_INVESTIGATIONS_FILE || "",
    environment: process.env.AURA_STATUS_ENVIRONMENT || "unknown",
    source: process.env.AURA_STATUS_SOURCE || "aura-status",
    provider: defaultProvider,
    baseUrl: process.env.AURA_STATUS_INVESTIGATOR_BASE_URL || "",
    apiKey: process.env.AURA_STATUS_INVESTIGATOR_API_KEY || "",
    model: process.env.AURA_STATUS_INVESTIGATOR_MODEL || "",
    timeoutMs: Number(process.env.AURA_STATUS_INVESTIGATOR_TIMEOUT_MS || 90_000),
    maxTokens: Number(process.env.AURA_STATUS_INVESTIGATOR_MAX_TOKENS || 4_000),
    maxChecks: Number(process.env.AURA_STATUS_INVESTIGATOR_MAX_CHECKS || 8),
    sourceHints: process.env.AURA_STATUS_INVESTIGATOR_SOURCE_HINTS !== "0",
    sourceContext: process.env.AURA_STATUS_INVESTIGATOR_SOURCE_CONTEXT !== "0",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--checks-dir") args.checksDir = path.resolve(next());
    else if (arg === "--checks-file") args.checksFile = path.resolve(next());
    else if (arg === "--registry") args.registry = path.resolve(next());
    else if (arg === "--expectations") args.expectationsFile = path.resolve(next());
    else if (arg === "--out-dir") args.outDir = path.resolve(next());
    else if (arg === "--out-file") args.outFile = path.resolve(next());
    else if (arg === "--environment") args.environment = next();
    else if (arg === "--source") args.source = next();
    else if (arg === "--provider") args.provider = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--api-key") args.apiKey = next();
    else if (arg === "--model") args.model = next();
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next());
    else if (arg === "--max-checks") args.maxChecks = Number(next());
    else if (arg === "--no-source-hints") args.sourceHints = false;
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/run-status-investigations.mjs [--checks-dir DIR] [--out-dir DIR] [--base-url URL] [--api-key KEY] [--model MODEL]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 90_000;
  if (!Number.isFinite(args.maxTokens) || args.maxTokens <= 0) args.maxTokens = 4_000;
  if (!Number.isFinite(args.maxChecks) || args.maxChecks <= 0) args.maxChecks = 8;
  if (args.provider === "anthropic") {
    args.baseUrl = args.baseUrl || "https://api.anthropic.com/v1";
    args.apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY || "";
  }
  if (!args.outFile) args.outFile = path.join(args.outDir, "investigations.json");
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
  const checks = [];
  if (args.checksFile) {
    const payload = await readJson(args.checksFile);
    return checksFromPayload(payload, generatedAt);
  }
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

function findFeature(registry, check) {
  return (registry.features ?? []).find((feature) => feature.id === check.featureId)
    ?? (registry.features ?? []).find((feature) => (feature.checks ?? []).some((config) => config.id === check.checkId))
    ?? null;
}

function findCheckConfig(feature, checkId) {
  return (feature?.checks ?? []).find((config) => config.id === checkId) ?? null;
}

async function collectSourceHints(check, expectation, enabled) {
  if (!enabled) return [];
  const needles = sourceNeedlesForCheck(check, expectation).slice(0, 8);
  const hints = [];
  for (const needle of needles) {
    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "-n",
          "--fixed-strings",
          "--max-count",
          "6",
          "--glob",
          "!node_modules",
          "--glob",
          "!target",
          "--glob",
          "!interface/node_modules",
          needle,
          repoRoot,
        ],
        { timeout: 5_000, maxBuffer: 256_000 },
      );
      for (const line of stdout.split("\n").filter(Boolean).slice(0, 6)) {
        const match = line.match(/^(.*?):(\d+):(.*)$/);
        if (!match) continue;
        hints.push({
          needle,
          path: path.relative(repoRoot, match[1]),
          line: Number(match[2]),
          preview: match[3].trim().slice(0, 500),
        });
      }
    } catch {
      // Source hints are helpful but never required for the investigator.
    }
    if (hints.length >= 24) break;
  }
  return hints.slice(0, 24);
}

async function collectSourceContext(sourceHints, enabled) {
  if (!enabled || sourceHints.length === 0) return [];
  const contexts = [];
  const seen = new Set();
  for (const hint of sourceHints) {
    if (!hint.path || !Number.isFinite(Number(hint.line))) continue;
    const key = `${hint.path}:${hint.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const filePath = path.join(repoRoot, hint.path);
    if (!filePath.startsWith(repoRoot)) continue;
    try {
      const lines = (await fs.readFile(filePath, "utf8")).split("\n");
      const line = Math.max(1, Number(hint.line));
      const startLine = Math.max(1, line - 3);
      const endLine = Math.min(lines.length, line + 3);
      const excerpt = lines
        .slice(startLine - 1, endLine)
        .map((text, index) => `${startLine + index}: ${text}`)
        .join("\n");
      contexts.push({
        path: hint.path,
        startLine,
        endLine,
        excerpt: excerpt.slice(0, 2_000),
      });
    } catch {
      // Source context is supplementary and should never block investigation.
    }
    if (contexts.length >= 8) break;
  }
  return contexts;
}

async function callOpenAiCompatible(args, { messages }) {
  if (!args.baseUrl || !args.apiKey || !args.model) {
    throw new Error("AURA_STATUS_INVESTIGATOR_BASE_URL, AURA_STATUS_INVESTIGATOR_API_KEY, and AURA_STATUS_INVESTIGATOR_MODEL are required.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`investigator timed out after ${args.timeoutMs}ms`)), args.timeoutMs);
  try {
    const response = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Investigator request failed with ${response.status}: ${text}`);
    const payload = text ? JSON.parse(text) : null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Investigator response did not include message content");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(args, { messages }) {
  if (!args.apiKey || !args.model) {
    throw new Error("AURA_STATUS_INVESTIGATOR_API_KEY or ANTHROPIC_API_KEY, and AURA_STATUS_INVESTIGATOR_MODEL are required.");
  }
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`investigator timed out after ${args.timeoutMs}ms`)), args.timeoutMs);
  try {
    const response = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxTokens,
        temperature: 0.1,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
        tools: [ANTHROPIC_INVESTIGATION_TOOL],
        tool_choice: { type: "tool", name: ANTHROPIC_INVESTIGATION_TOOL.name },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Anthropic investigator request failed with ${response.status}: ${text}`);
    const payload = text ? JSON.parse(text) : null;
    const toolUse = (payload?.content ?? []).find((block) =>
      block?.type === "tool_use"
        && block.name === ANTHROPIC_INVESTIGATION_TOOL.name
        && block.input
        && typeof block.input === "object",
    );
    if (toolUse) return toolUse.input;
    const content = (payload?.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!content) throw new Error("Anthropic investigator response did not include text content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function hasConfiguredModel(args) {
  if (args.provider === "anthropic") return Boolean(args.apiKey && args.model);
  return Boolean(args.baseUrl && args.apiKey && args.model);
}

function callInvestigatorModel(args, request) {
  if (args.provider === "anthropic") return callAnthropic(args, request);
  return callOpenAiCompatible(args, request);
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
  const failingChecks = checks.filter(needsInvestigation).slice(0, args.maxChecks);

  const payload = {
    schemaVersion: 1,
    generatedAt,
    environment: args.environment,
    source: args.source,
    provider: args.provider,
    model: args.model || null,
    investigations: [],
  };

  if (failingChecks.length === 0) {
    await writeJson(args.outFile, payload);
    process.stdout.write(`No failing or warning checks to investigate. Wrote ${path.relative(repoRoot, args.outFile)}\n`);
    return;
  }

  if (!hasConfiguredModel(args)) {
    await writeJson(args.outFile, payload);
    process.stdout.write(`No investigator model configured; wrote empty investigation set to ${path.relative(repoRoot, args.outFile)}\n`);
    return;
  }

  for (const check of failingChecks) {
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
    const sourceHints = await collectSourceHints(check, expectation, args.sourceHints);
    const sourceContext = await collectSourceContext(sourceHints, args.sourceHints && args.sourceContext);
    const verifierContext = buildInvestigationVerifierContext({
      check,
      expectation,
      siblingChecks,
      previousChecks,
      sourceHints,
      sourceContext,
    });
    payload.investigations.push(await investigateCheck({
      check,
      feature,
      checkConfig,
      expectation,
      siblingChecks,
      sourceHints,
      sourceContext,
      verifierContext,
      generatedAt,
      environment: args.environment,
      source: args.source,
      provider: args.provider,
      model: args.model,
      callModel: (request) => callInvestigatorModel(args, request),
    }));
  }

  await writeJson(args.outFile, payload);
  process.stdout.write(`Wrote ${payload.investigations.length} investigation(s) to ${path.relative(repoRoot, args.outFile)}\n`);
}

await main();
