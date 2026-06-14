import { createHash } from "node:crypto";

import { readPath } from "./check-expectations.mjs";
import { redactSensitive } from "./status-redaction.mjs";

export const LESSON_STATUS = Object.freeze({
  READY: "ready",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const LESSON_CONFIDENCE = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

export const LESSON_CATEGORY = Object.freeze({
  EVAL_COVERAGE: "eval-coverage",
  SOURCE_DISCOVERY: "source-discovery",
  REPAIR_PLAYBOOK: "repair-playbook",
  PROMPT_GUARDRAIL: "prompt-guardrail",
  WORKFLOW_RELIABILITY: "workflow-reliability",
  PRODUCT_RISK: "product-risk",
});

const VALID_STATUS = new Set(Object.values(LESSON_STATUS));
const VALID_CONFIDENCE = new Set(Object.values(LESSON_CONFIDENCE));
const VALID_CATEGORY = new Set(Object.values(LESSON_CATEGORY));

export const LEARNING_SYSTEM_PROMPT = [
  "You are AURA's observability learning analyst.",
  "You receive structured eval failures, expected-output contracts, investigations, source-discovery artifacts, suspect changes, repair proposals, and workflow outcomes.",
  "Produce JSON only. Do not include markdown.",
  "Your job is not to diagnose the current incident or propose a code diff. Extract durable lessons that make future evals, investigations, source discovery, and repairs better.",
  "Use only supplied evidence. Do not invent files, endpoints, incidents, PRs, or commands.",
  "Lessons must be reusable beyond this single run; avoid restating the visible failure unless it teaches a durable workflow rule.",
  "Cite supplied evidence ids, check ids, investigation ids, repair ids, source paths, or suspect commits in every lesson.",
  "Treat suspect commits or PRs as hypotheses, not proof of causality.",
  "Prefer lessons that strengthen expected outputs, add follow-up evals, improve source discovery, improve repair verification, or preserve useful human review constraints.",
].join(" ");

export function buildLearningInput({
  checks = [],
  investigations = [],
  repairs = [],
  learningCases = [],
  repairDispatchPlan = null,
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status-learning",
}) {
  return redactSensitive({
    schemaVersion: 1,
    learningGoal: "Extract durable AURA observability lessons from eval failures, investigations, repairs, and verification outcomes.",
    learningRules: [
      "Keep the status dashboard unchanged; lessons are private workflow memory.",
      "Do not propose a code diff.",
      "Do not weaken or remove eval contracts.",
      "Prefer lessons that would catch the same class of issue earlier next time.",
      "Separate product failure lessons from eval-harness or workflow-reliability lessons.",
    ],
    generatedAt,
    environment,
    source,
    runSummary: {
      checkCount: checks.length,
      failingCheckIds: checks.filter((check) => check.status === "fail").map((check) => check.checkId),
      warningCheckIds: checks.filter((check) => check.status === "warn").map((check) => check.checkId),
      investigationCount: investigations.length,
      repairCount: repairs.length,
      repairDispatchPlan,
    },
    cases: learningCases.map(buildLearningCase),
    responseSchema: {
      lessons: [
        {
          title: "Short durable lesson title.",
          category: "eval-coverage | source-discovery | repair-playbook | prompt-guardrail | workflow-reliability | product-risk",
          confidence: "low | medium | high",
          summary: "Reusable lesson learned from this run.",
          evidence: ["Evidence ids, check ids, investigation ids, repair ids, source paths, or suspect commits."],
          appliesTo: ["Feature ids, check ids, paths, or workflow phases this lesson should influence."],
          recommendedActions: ["Concrete future action."],
          followUpEvals: ["New or refined eval ideas."],
          sourceDiscoveryHints: ["Search/source localization improvements."],
          repairPlaybookNotes: ["Repair-loop behavior to prefer or avoid next time."],
          promptGuardrails: ["Prompt or policy wording to preserve or add."],
          expiresWhen: "Optional condition that would make this lesson obsolete.",
        },
      ],
    },
  });
}

export function buildLearningMessages(input) {
  return [
    { role: "system", content: LEARNING_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(input, null, 2) },
  ];
}

export async function extractLessons({
  checks = [],
  investigations = [],
  repairs = [],
  learningCases = [],
  repairDispatchPlan = null,
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status-learning",
  provider,
  model,
  callModel,
}) {
  const input = buildLearningInput({
    checks,
    investigations,
    repairs,
    learningCases,
    repairDispatchPlan,
    generatedAt,
    environment,
    source,
  });
  const messages = buildLearningMessages(input);
  try {
    const content = await callModel({ messages, input });
    return normalizeLearningResponse(content, {
      generatedAt,
      environment,
      source,
      provider,
      model,
    });
  } catch (error) {
    return normalizeLearningPayload({
      schemaVersion: 1,
      kind: "llm-observability-lessons",
      status: LESSON_STATUS.FAILED,
      generatedAt,
      environment,
      source,
      provider,
      model,
      lessons: [],
      error: error instanceof Error ? error.message : String(error),
    }, generatedAt);
  }
}

export function normalizeLearningResponse(content, metadata = {}) {
  const parsed = parseJsonObject(content);
  return normalizeLearningPayload({
    ...parsed,
    schemaVersion: 1,
    kind: "llm-observability-lessons",
    status: LESSON_STATUS.READY,
    generatedAt: metadata.generatedAt,
    environment: metadata.environment,
    source: metadata.source,
    provider: metadata.provider,
    model: metadata.model,
  }, metadata.generatedAt);
}

export function normalizeLearningPayload(raw, generatedAt = new Date().toISOString()) {
  return redactSensitive({
    schemaVersion: 1,
    kind: "llm-observability-lessons",
    status: VALID_STATUS.has(raw?.status) ? raw.status : LESSON_STATUS.READY,
    generatedAt: normalizeIsoDate(raw?.generatedAt, generatedAt),
    environment: typeof raw?.environment === "string" ? raw.environment : undefined,
    source: typeof raw?.source === "string" ? raw.source : undefined,
    provider: typeof raw?.provider === "string" ? raw.provider : undefined,
    model: typeof raw?.model === "string" ? raw.model : undefined,
    lessons: normalizeLessons(raw?.lessons, raw?.generatedAt ?? generatedAt),
    error: typeof raw?.error === "string" ? raw.error : undefined,
  });
}

export function buildSkippedLearningPayload({
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status-learning",
  provider,
  model,
  reason,
}) {
  return normalizeLearningPayload({
    schemaVersion: 1,
    kind: "llm-observability-lessons",
    status: LESSON_STATUS.SKIPPED,
    generatedAt,
    environment,
    source,
    provider,
    model,
    lessons: [],
    error: reason,
  }, generatedAt);
}

function buildLearningCase(entry) {
  const check = entry.check ?? {};
  const expectation = entry.expectation ?? null;
  const requiredEvidence = Array.isArray(expectation?.requiredEvidence) ? expectation.requiredEvidence : [];
  const evidence = check?.evidence && typeof check.evidence === "object" ? check.evidence : {};
  const missingRequiredEvidence = requiredEvidence.filter((path) => {
    const value = readPath(evidence, path);
    return value === undefined || value === null;
  });
  return {
    id: `${check.featureId ?? "unknown"}:${check.checkId ?? "unknown"}`,
    feature: entry.feature ?? null,
    checkConfig: entry.checkConfig ?? null,
    check: {
      checkId: check.checkId ?? null,
      featureId: check.featureId ?? null,
      status: check.status ?? null,
      message: check.message ?? "",
      endedAt: check.endedAt ?? null,
      latencyMs: check.latencyMs ?? null,
      evidence,
    },
    expectedOutputContract: expectation ? {
      description: expectation.description ?? null,
      requiredEvidence,
      missingRequiredEvidence,
      assertions: Array.isArray(expectation.assertions) ? expectation.assertions : [],
    } : null,
    investigation: summarizeInvestigation(entry.investigation),
    repair: summarizeRepair(entry.repair),
    verifierContext: entry.verifierContext ?? null,
    sourceDiscovery: entry.sourceDiscovery ?? null,
  };
}

function summarizeInvestigation(investigation) {
  if (!investigation || typeof investigation !== "object") return null;
  return {
    id: investigation.id ?? null,
    status: investigation.status ?? null,
    title: investigation.title ?? null,
    confidence: investigation.confidence ?? null,
    summary: investigation.summary ?? "",
    rootCause: investigation.rootCause ?? "",
    proof: normalizeStringArray(investigation.proof),
    possibleCauses: normalizeStringArray(investigation.possibleCauses),
    reproductionSteps: Array.isArray(investigation.reproductionSteps) ? investigation.reproductionSteps.slice(0, 8) : [],
    affectedAreas: Array.isArray(investigation.affectedAreas) ? investigation.affectedAreas.slice(0, 8) : [],
    recommendedVerifierProbes: Array.isArray(investigation.recommendedVerifierProbes) ? investigation.recommendedVerifierProbes.slice(0, 8) : [],
    recommendedNextActions: normalizeStringArray(investigation.recommendedNextActions),
    followUpEvals: normalizeStringArray(investigation.followUpEvals),
  };
}

function summarizeRepair(repair) {
  if (!repair || typeof repair !== "object") return null;
  return {
    id: repair.id ?? null,
    status: repair.status ?? null,
    repairable: repair.repairable === true,
    confidence: repair.confidence ?? null,
    title: repair.title ?? null,
    summary: repair.summary ?? "",
    rootCause: repair.rootCause ?? "",
    proof: normalizeStringArray(repair.proof),
    changePlan: normalizeStringArray(repair.changePlan),
    targetFiles: normalizeStringArray(repair.targetFiles),
    verificationCommands: normalizeStringArray(repair.verificationCommands),
    risks: normalizeStringArray(repair.risks),
    apply: repair.apply && typeof repair.apply === "object"
      ? {
        patchPaths: Array.isArray(repair.apply.patchPaths) ? repair.apply.patchPaths : [],
        commitSha: repair.apply.commitSha ?? null,
        prUrl: repair.apply.prUrl ?? null,
        verificationResults: Array.isArray(repair.apply.verificationResults)
          ? repair.apply.verificationResults.map((result) => ({
            command: result.command ?? null,
            exitCode: result.exitCode ?? null,
          }))
          : [],
      }
      : null,
    error: typeof repair.error === "string" ? repair.error : undefined,
  };
}

function normalizeLessons(value, generatedAt) {
  if (!Array.isArray(value)) return [];
  return value
    .map((lesson, index) => normalizeLesson(lesson, index, generatedAt))
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeLesson(raw, index, generatedAt) {
  if (!raw || typeof raw !== "object") return null;
  const title = stringOrDefault(raw.title, "");
  const summary = stringOrDefault(raw.summary, "");
  const evidence = normalizeStringArray(raw.evidence);
  if (!title || !summary || evidence.length === 0) return null;
  const category = VALID_CATEGORY.has(raw.category) ? raw.category : LESSON_CATEGORY.WORKFLOW_RELIABILITY;
  return {
    id: stringOrDefault(raw.id, lessonId(category, title, generatedAt, index)),
    title,
    category,
    confidence: VALID_CONFIDENCE.has(raw.confidence) ? raw.confidence : LESSON_CONFIDENCE.LOW,
    summary,
    evidence,
    appliesTo: normalizeStringArray(raw.appliesTo),
    recommendedActions: normalizeStringArray(raw.recommendedActions),
    followUpEvals: normalizeStringArray(raw.followUpEvals),
    sourceDiscoveryHints: normalizeStringArray(raw.sourceDiscoveryHints),
    repairPlaybookNotes: normalizeStringArray(raw.repairPlaybookNotes),
    promptGuardrails: normalizeStringArray(raw.promptGuardrails),
    expiresWhen: typeof raw.expiresWhen === "string" && raw.expiresWhen.trim() ? raw.expiresWhen.trim() : null,
  };
}

function parseJsonObject(content) {
  if (content && typeof content === "object" && !Array.isArray(content)) return content;
  if (typeof content !== "string") throw new Error("Learning response was not a string or JSON object");
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
  throw new Error("Learning response did not contain a JSON object");
}

function lessonId(category, title, generatedAt, index) {
  const digest = createHash("sha256")
    .update(`${category}:${title}:${generatedAt}:${index}`)
    .digest("hex")
    .slice(0, 12);
  return `${category}:${digest}`;
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
