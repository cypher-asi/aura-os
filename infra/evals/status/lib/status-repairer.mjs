import { createHash } from "node:crypto";
import path from "node:path";

import { redactSensitive } from "./status-redaction.mjs";

export const REPAIR_STATUS = Object.freeze({
  READY: "ready",
  APPLIED: "applied",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const REPAIR_CONFIDENCE = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

const VALID_REPAIR_CONFIDENCE = new Set(Object.values(REPAIR_CONFIDENCE));
const VALID_REPAIR_STATUS = new Set(Object.values(REPAIR_STATUS));

export const REPAIR_SYSTEM_PROMPT = [
  "You are AURA's gated observability repair planner.",
  "You receive a structured repair packet with a failing eval, the LLM investigation, expected-output contracts, source-discovery artifacts, verifier context, and reproduction commands.",
  "Produce JSON only. Do not include markdown.",
  "Use only supplied evidence and source-discovery artifacts. If the fix is uncertain or unsafe, set repairable=false and explain the missing evidence.",
  "Do not invent files, commands, endpoints, or line numbers.",
  "Prefer the smallest production or eval-harness patch that addresses the earliest proven boundary failure.",
  "Do not mask a real product failure by weakening expected-output contracts unless the investigation proves the eval contract is wrong.",
  "Do not remove checks, skip checks, relax required evidence, or silence failures as a repair.",
  "A valid repairable response must include targetFiles, a unifiedDiff, verificationCommands, proof, risks, and a human-review note.",
  "The unifiedDiff must be directly applicable from the repository root with git apply.",
].join(" ");

export function buildRepairInput({
  check,
  feature,
  checkConfig,
  expectation,
  investigation,
  sourceHints = [],
  sourceContext = [],
  sourceDiscovery = null,
  verifierContext = null,
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status-repair",
}) {
  return redactSensitive({
    schemaVersion: 1,
    repairGoal: "Propose the smallest gated code repair for this AURA observability eval failure.",
    repairRules: [
      "Confirm the failing eval and expected-output contract before proposing a patch.",
      "Use sourceDiscovery.candidateCodePaths first when choosing target files.",
      "Cite supplied proof, investigation details, source-discovery artifacts, or verifier context.",
      "Preserve or strengthen eval coverage; do not hide failures by weakening checks.",
      "Return a unified diff only when the fix is sufficiently supported by the supplied evidence.",
    ],
    generatedAt,
    environment,
    source,
    feature: {
      id: feature?.id ?? check?.featureId ?? null,
      label: feature?.label ?? null,
      category: feature?.category ?? null,
      description: feature?.description ?? null,
      publicSummary: feature?.publicSummary ?? null,
      checkConfig: checkConfig ?? null,
    },
    failedCheck: {
      checkId: check?.checkId ?? null,
      featureId: check?.featureId ?? null,
      label: check?.label ?? checkConfig?.label ?? check?.checkId ?? null,
      status: check?.status ?? null,
      message: check?.message ?? "",
      startedAt: check?.startedAt ?? null,
      endedAt: check?.endedAt ?? null,
      latencyMs: check?.latencyMs ?? null,
      evidence: check?.evidence ?? {},
    },
    expectedOutputContract: expectation ?? null,
    investigation: investigation ? {
      id: investigation.id ?? null,
      title: investigation.title ?? null,
      confidence: investigation.confidence ?? null,
      summary: investigation.summary ?? "",
      rootCause: investigation.rootCause ?? "",
      proof: investigation.proof ?? [],
      possibleCauses: investigation.possibleCauses ?? [],
      reproductionSteps: investigation.reproductionSteps ?? [],
      affectedAreas: investigation.affectedAreas ?? [],
      whatWouldDisproveThis: investigation.whatWouldDisproveThis ?? [],
      recommendedVerifierProbes: investigation.recommendedVerifierProbes ?? [],
      recommendedNextActions: investigation.recommendedNextActions ?? [],
      followUpEvals: investigation.followUpEvals ?? [],
    } : null,
    sourceDiscovery,
    sourceHints,
    sourceContext,
    verifierContext,
    defaultReproductionCommand: check?.checkId ? `AURA_STATUS_CHECKS=${check.checkId} npm run status:probes` : "npm run status:probes",
    defaultVerificationCommands: [
      check?.checkId ? `AURA_STATUS_CHECKS=${check.checkId} npm run status:probes` : "npm run status:probes",
      "node --test $(rg --files infra/evals/status | rg 'test\\.mjs$')",
    ],
    responseSchema: {
      repairable: "boolean",
      title: "Short repair title.",
      confidence: "low | medium | high",
      summary: "What the patch changes and why.",
      rootCause: "Best evidence-backed root cause, or explicit uncertainty.",
      proof: ["Evidence ids, source-discovery facts, or investigation proof supporting this repair."],
      changePlan: ["Ordered implementation steps."],
      targetFiles: ["Repository-relative files expected to change."],
      unifiedDiff: "Repository-root unified diff, empty only when repairable=false.",
      verificationCommands: ["Commands that should prove the repair."],
      risks: ["Residual risk or review caveat."],
      requiresHumanReview: "boolean",
      followUpEvals: ["Eval additions or refinements that would catch this earlier."],
    },
  });
}

export function buildRepairMessages(input) {
  return [
    { role: "system", content: REPAIR_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(input, null, 2) },
  ];
}

export async function proposeRepair({
  check,
  feature,
  checkConfig,
  expectation,
  investigation,
  sourceHints = [],
  sourceContext = [],
  sourceDiscovery = null,
  verifierContext = null,
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status-repair",
  provider,
  model,
  callModel,
}) {
  const input = buildRepairInput({
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
    environment,
    source,
  });
  const messages = buildRepairMessages(input);

  try {
    let content = await callModel({ messages, input });
    let repair = normalizeRepairResponse(content, {
      check,
      feature,
      investigation,
      generatedAt,
      environment,
      source,
      provider,
      model,
    });
    const missing = missingRequiredRepairFields(repair);
    if (missing.length > 0) {
      content = await callModel({
        messages: [
          ...messages,
          {
            role: "user",
            content: `The previous repair proposal was missing required fields: ${missing.join(", ")}. Return the same structured JSON again using only supplied evidence. If no safe patch is supported, set repairable=false and explain why.`,
          },
        ],
        input,
      });
      repair = normalizeRepairResponse(content, {
        check,
        feature,
        investigation,
        generatedAt,
        environment,
        source,
        provider,
        model,
      });
    }
    const retryMissing = missingRequiredRepairFields(repair);
    if (retryMissing.length > 0) {
      throw new Error(`Repair proposal missing required fields after retry: ${retryMissing.join(", ")}`);
    }
    return repair;
  } catch (error) {
    return normalizeRepair({
      schemaVersion: 1,
      kind: "llm-repair",
      id: repairId(feature?.id ?? check?.featureId, check?.checkId, generatedAt),
      featureId: feature?.id ?? check?.featureId ?? null,
      featureLabel: feature?.label ?? feature?.id ?? "Unknown feature",
      checkId: check?.checkId,
      investigationId: investigation?.id ?? null,
      status: REPAIR_STATUS.FAILED,
      generatedAt,
      environment,
      source,
      provider,
      model,
      repairable: false,
      confidence: "low",
      title: "Repair proposal failed",
      summary: "The repair model did not return a usable proposal.",
      rootCause: "Repair proposal generation failed before a patch could be produced.",
      proof: [],
      changePlan: [],
      targetFiles: [],
      unifiedDiff: "",
      verificationCommands: [],
      risks: ["Rerun the repair loop with model/provider logs enabled."],
      requiresHumanReview: true,
      followUpEvals: [],
      error: error instanceof Error ? error.message : String(error),
    }, generatedAt);
  }
}

export function normalizeRepairResponse(content, metadata) {
  const parsed = parseJsonObject(content);
  return normalizeRepair({
    ...parsed,
    schemaVersion: 1,
    kind: "llm-repair",
    id: repairId(metadata.feature?.id ?? metadata.check?.featureId, metadata.check?.checkId, metadata.generatedAt),
    featureId: metadata.feature?.id ?? metadata.check?.featureId ?? null,
    featureLabel: metadata.feature?.label ?? metadata.feature?.id ?? "Unknown feature",
    checkId: metadata.check?.checkId,
    investigationId: metadata.investigation?.id ?? null,
    status: REPAIR_STATUS.READY,
    generatedAt: metadata.generatedAt,
    environment: metadata.environment,
    source: metadata.source,
    provider: metadata.provider,
    model: metadata.model,
  }, metadata.generatedAt);
}

export function normalizeRepair(raw, generatedAt = new Date().toISOString()) {
  const checkId = typeof raw?.checkId === "string" ? raw.checkId.trim() : "";
  if (!checkId) return null;
  const featureId = typeof raw.featureId === "string" && raw.featureId.trim() ? raw.featureId.trim() : null;
  const repairable = raw.repairable === true;
  return {
    schemaVersion: 1,
    kind: "llm-repair",
    id: stringOrDefault(raw.id, repairId(featureId, checkId, generatedAt)),
    featureId,
    featureLabel: stringOrDefault(raw.featureLabel, featureId ?? "Unknown feature"),
    checkId,
    investigationId: typeof raw.investigationId === "string" ? raw.investigationId : null,
    status: VALID_REPAIR_STATUS.has(raw.status) ? raw.status : REPAIR_STATUS.READY,
    generatedAt: normalizeIsoDate(raw.generatedAt, generatedAt),
    environment: typeof raw.environment === "string" ? raw.environment : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    repairable,
    confidence: VALID_REPAIR_CONFIDENCE.has(raw.confidence) ? raw.confidence : REPAIR_CONFIDENCE.LOW,
    title: stringOrDefault(raw.title, "Repair proposal"),
    summary: stringOrDefault(raw.summary, ""),
    rootCause: stringOrDefault(raw.rootCause, ""),
    proof: normalizeStringArray(raw.proof),
    changePlan: normalizeStringArray(raw.changePlan),
    targetFiles: normalizeStringArray(raw.targetFiles),
    unifiedDiff: typeof raw.unifiedDiff === "string" ? raw.unifiedDiff : "",
    verificationCommands: normalizeStringArray(raw.verificationCommands),
    risks: normalizeStringArray(raw.risks),
    requiresHumanReview: raw.requiresHumanReview !== false,
    followUpEvals: normalizeStringArray(raw.followUpEvals),
    apply: raw.apply && typeof raw.apply === "object" ? raw.apply : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

export function missingRequiredRepairFields(repair) {
  const missing = [];
  if (!repair?.summary) missing.push("summary");
  if (!repair?.rootCause) missing.push("rootCause");
  if (!Array.isArray(repair?.proof) || repair.proof.length === 0) missing.push("proof");
  if (!Array.isArray(repair?.changePlan) || repair.changePlan.length === 0) missing.push("changePlan");
  if (!Array.isArray(repair?.risks) || repair.risks.length === 0) missing.push("risks");
  if (repair?.repairable) {
    if (!Array.isArray(repair?.targetFiles) || repair.targetFiles.length === 0) missing.push("targetFiles");
    if (!repair?.unifiedDiff) missing.push("unifiedDiff");
    if (!Array.isArray(repair?.verificationCommands) || repair.verificationCommands.length === 0) {
      missing.push("verificationCommands");
    }
  }
  return missing;
}

export function validateUnifiedDiff(unifiedDiff, { repoRoot = "", allowedPathPrefixes = [] } = {}) {
  if (typeof unifiedDiff !== "string" || !unifiedDiff.trim()) return [];
  const paths = pathsFromUnifiedDiff(unifiedDiff);
  const issues = [];
  if (paths.length === 0) issues.push("Unified diff did not include any file paths.");
  for (const filePath of paths) {
    if (!isSafeRelativePath(filePath)) {
      issues.push(`Unsafe patch path: ${filePath}`);
      continue;
    }
    if (isForbiddenPath(filePath)) issues.push(`Forbidden patch path: ${filePath}`);
    if (allowedPathPrefixes.length > 0 && !allowedPathPrefixes.some((prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`))) {
      issues.push(`Patch path is outside allowed prefixes: ${filePath}`);
    }
    if (repoRoot && !isInsideDirectory(filePath, repoRoot)) issues.push(`Patch path escapes repository root: ${filePath}`);
  }
  return issues;
}

export function pathsFromUnifiedDiff(unifiedDiff) {
  const paths = new Set();
  for (const line of unifiedDiff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    if (match[1] !== "/dev/null") paths.add(match[1]);
    if (match[2] !== "/dev/null") paths.add(match[2]);
  }
  return [...paths];
}

function parseJsonObject(content) {
  if (content && typeof content === "object" && !Array.isArray(content)) return content;
  if (typeof content !== "string") throw new Error("Repair response was not a string or JSON object");
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  }
  throw new Error("Repair response did not contain a JSON object");
}

function repairId(featureId, checkId, generatedAt) {
  const digest = createHash("sha256")
    .update(`${featureId ?? "unknown"}:${checkId ?? "unknown"}:${generatedAt}`)
    .digest("hex")
    .slice(0, 12);
  return `${featureId ?? "unknown"}:${checkId ?? "unknown"}:${digest}`;
}

function normalizeIsoDate(value, fallback) {
  const candidate = typeof value === "string" && value.trim() ? value : fallback;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean);
}

function isSafeRelativePath(filePath) {
  return Boolean(filePath)
    && !pathIsAbsolute(filePath)
    && !filePath.split("/").includes("..")
    && !filePath.includes("\0");
}

function isForbiddenPath(filePath) {
  return filePath.startsWith(".git/")
    || filePath.startsWith("node_modules/")
    || filePath.includes("/node_modules/")
    || filePath.startsWith("infra/evals/reports/")
    || filePath.includes("/dist/")
    || filePath.endsWith(".env")
    || filePath.includes(".env.");
}

function pathIsAbsolute(filePath) {
  return path.isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath);
}

function isInsideDirectory(filePath, repoRoot) {
  const relativePath = path.relative(path.resolve(repoRoot), path.resolve(repoRoot, filePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
