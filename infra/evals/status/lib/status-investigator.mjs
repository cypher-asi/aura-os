import { createHash } from "node:crypto";

import { buildInvestigationEvidencePacket } from "./status-investigation-packets.mjs";
import { INVESTIGATION_STATUS, normalizeInvestigation } from "./status-investigations.mjs";
import { redactSensitive as redactSensitiveValue } from "./status-redaction.mjs";

export { redactSensitiveValue as redactSensitive };

const COMMON_SOURCE_NEEDLES = new Set([
  "allPassed",
  "count",
  "error",
  "failed",
  "message",
  "model",
  "passed",
  "provider",
  "results",
  "status",
  "total",
]);

export const INVESTIGATOR_SYSTEM_PROMPT = [
  "You are AURA's observability investigator.",
  "You receive a structured investigation packet with failing eval evidence, expected-output contracts, sibling check context, source-search hints, and reproduction hints.",
  "Produce JSON only. Do not include markdown.",
  "Use only the supplied evidence and source hints. If the root cause is uncertain, say so and explain what evidence would prove or disprove it.",
  "Do not invent file paths, commands, endpoints, or line numbers.",
  "Proof points should cite investigationPacket.evidenceItems ids when possible.",
  "Distinguish an eval failure from a user-facing product outage. Do not claim production users or real traffic are impacted unless the supplied evidence includes user-traffic or incident signals.",
  "If a broad health check passed but a specific endpoint or route failed, localize the diagnosis to that endpoint, route, version, or configuration instead of declaring the whole service down.",
  "Every report must include at least one proof point, possible cause, reproduction step, affected area, and recommended next action.",
  "If no exact file path is proven, affectedAreas must name the implicated product or runtime area without a path.",
  "Do not propose a code diff. Focus on proving the problem exists, localizing where it appears to exist, possible causes, reproduction steps, and follow-up evals.",
].join(" ");

export function needsInvestigation(check) {
  return check?.status === "fail" || check?.status === "warn";
}

export function buildInvestigationInput({
  check,
  feature,
  checkConfig,
  expectation,
  siblingChecks = [],
  sourceHints = [],
}) {
  const investigationPacket = buildInvestigationEvidencePacket({
    check,
    feature,
    checkConfig,
    expectation,
    siblingChecks,
    sourceHints,
  });
  return redactSensitiveValue({
    schemaVersion: 1,
    investigationGoal: "Explain this AURA observability eval failure with evidence-backed diagnosis and reproduction steps.",
    investigationPacket,
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
      label: check?.label ?? null,
      status: check?.status ?? null,
      message: check?.message ?? "",
      startedAt: check?.startedAt ?? null,
      endedAt: check?.endedAt ?? null,
      runGeneratedAt: check?.runGeneratedAt ?? null,
      latencyMs: check?.latencyMs ?? null,
      environment: check?.environment ?? null,
      evidence: check?.evidence ?? {},
    },
    expectedOutputContract: expectation ?? null,
    siblingChecks: siblingChecks.map((sibling) => ({
      checkId: sibling.checkId,
      featureId: sibling.featureId,
      status: sibling.status,
      message: sibling.message,
      endedAt: sibling.endedAt,
      latencyMs: sibling.latencyMs,
      evidence: sibling.evidence ?? {},
    })),
    sourceHints,
    responseSchema: {
      title: "Short investigator report title.",
      confidence: "low | medium | high",
      summary: "One or two sentences proving the visible failure.",
      rootCause: "Best evidence-backed root cause, or explicit uncertainty. Keep impact scoped to the eval evidence.",
      proof: ["Evidence points from the eval result or source hints."],
      possibleCauses: ["Plausible causes ranked by evidence strength."],
      reproductionSteps: [
        {
          label: "Human-readable step label",
          command: "Optional command if directly supported by supplied evidence",
        },
      ],
      affectedAreas: [
        {
          label: "Area, product surface, runtime component, or code path",
          path: "Optional exact path from source hints",
          reason: "Why this area is implicated",
        },
      ],
      recommendedNextActions: ["Concrete next actions for an engineer."],
      followUpEvals: ["New or refined evals that would catch this earlier."],
    },
  });
}

export function buildInvestigationMessages(input) {
  return [
    { role: "system", content: INVESTIGATOR_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(input, null, 2) },
  ];
}

export async function investigateCheck({
  check,
  feature,
  checkConfig,
  expectation,
  siblingChecks = [],
  sourceHints = [],
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status",
  provider,
  model,
  callModel,
}) {
  const input = buildInvestigationInput({ check, feature, checkConfig, expectation, siblingChecks, sourceHints });
  const messages = buildInvestigationMessages(input);
  try {
    let content = await callModel({ messages, input });
    let investigation = normalizeInvestigationResponse(content, {
      check,
      feature,
      generatedAt,
      environment,
      source,
      provider,
      model,
    });
    const missing = missingRequiredInvestigationFields(investigation);
    if (missing.length > 0) {
      content = await callModel({
        messages: [
          ...messages,
          {
            role: "user",
            content: `The previous report was missing required non-empty fields: ${missing.join(", ")}. Return the same structured report again, but fill every missing field using only the supplied evidence and source hints.`,
          },
        ],
        input,
      });
      investigation = normalizeInvestigationResponse(content, {
        check,
        feature,
        generatedAt,
        environment,
        source,
        provider,
        model,
      });
    }
    const retryMissing = missingRequiredInvestigationFields(investigation);
    if (retryMissing.length > 0) {
      throw new Error(`Investigator report missing required fields after retry: ${retryMissing.join(", ")}`);
    }
    return investigation;
  } catch (error) {
    return normalizeInvestigation({
      schemaVersion: 1,
      kind: "llm-investigation",
      id: investigationId(feature?.id ?? check?.featureId, check?.checkId, generatedAt),
      featureId: feature?.id ?? check?.featureId ?? null,
      featureLabel: feature?.label ?? feature?.id ?? "Unknown feature",
      checkId: check?.checkId,
      title: "Investigator failed",
      status: INVESTIGATION_STATUS.FAILED,
      checkStatus: check?.status ?? null,
      generatedAt,
      environment,
      source,
      provider,
      model,
      confidence: "low",
      summary: "The investigator model did not return a usable report.",
      rootCause: "Investigator execution failed before a diagnosis could be produced.",
      proof: [],
      possibleCauses: [],
      reproductionSteps: [],
      affectedAreas: [],
      recommendedNextActions: ["Rerun the observability investigation with model/provider logs enabled."],
      followUpEvals: [],
      evidenceDigest: evidenceDigest(check),
      error: error instanceof Error ? error.message : String(error),
    }, generatedAt);
  }
}

export function missingRequiredInvestigationFields(investigation) {
  const missing = [];
  if (!investigation?.summary) missing.push("summary");
  if (!investigation?.rootCause) missing.push("rootCause");
  if (!Array.isArray(investigation?.proof) || investigation.proof.length === 0) missing.push("proof");
  if (!Array.isArray(investigation?.possibleCauses) || investigation.possibleCauses.length === 0) missing.push("possibleCauses");
  if (!Array.isArray(investigation?.reproductionSteps) || investigation.reproductionSteps.length === 0) missing.push("reproductionSteps");
  if (!Array.isArray(investigation?.affectedAreas) || investigation.affectedAreas.length === 0) missing.push("affectedAreas");
  if (!Array.isArray(investigation?.recommendedNextActions) || investigation.recommendedNextActions.length === 0) {
    missing.push("recommendedNextActions");
  }
  return missing;
}

export function normalizeInvestigationResponse(content, {
  check,
  feature,
  generatedAt,
  environment,
  source,
  provider,
  model,
}) {
  const parsed = parseJsonObject(content);
  return normalizeInvestigation({
    ...parsed,
    schemaVersion: 1,
    kind: "llm-investigation",
    id: investigationId(feature?.id ?? check?.featureId, check?.checkId, generatedAt),
    featureId: feature?.id ?? check?.featureId ?? null,
    featureLabel: feature?.label ?? feature?.id ?? "Unknown feature",
    checkId: check?.checkId,
    status: INVESTIGATION_STATUS.READY,
    checkStatus: check?.status ?? null,
    generatedAt,
    environment,
    source,
    provider,
    model,
    evidenceDigest: evidenceDigest(check),
  }, generatedAt);
}

export function sourceNeedlesForCheck(check, expectation) {
  const needles = new Set();
  addNeedle(needles, check?.checkId);
  addNeedle(needles, check?.featureId);
  for (const value of stringsFromValue(check?.message)) addNeedle(needles, value);
  for (const value of stringsFromValue(check?.evidence)) addNeedle(needles, value);
  for (const value of expectation?.requiredEvidence ?? []) addNeedle(needles, value);
  return [...needles].slice(0, 16);
}

function parseJsonObject(content) {
  if (content && typeof content === "object" && !Array.isArray(content)) return content;
  if (typeof content !== "string") throw new Error("Investigator response was not a string or JSON object");
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
  throw new Error("Investigator response did not contain a JSON object");
}

function investigationId(featureId, checkId, generatedAt) {
  const digest = createHash("sha256")
    .update(`${featureId ?? "unknown"}:${checkId ?? "unknown"}:${generatedAt}`)
    .digest("hex")
    .slice(0, 12);
  return `${featureId ?? "unknown"}:${checkId ?? "unknown"}:${digest}`;
}

function evidenceDigest(check) {
  return redactSensitiveValue({
    message: check?.message ?? "",
    latencyMs: check?.latencyMs ?? null,
    evidence: check?.evidence ?? {},
  });
}

function addNeedle(needles, value) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return;
  if (/^\d+$/.test(trimmed)) return;
  if (COMMON_SOURCE_NEEDLES.has(trimmed)) return;
  needles.add(trimmed);
}

function stringsFromValue(value, strings = []) {
  if (value == null) return strings;
  if (typeof value === "string") {
    const endpointMatches = value.match(/\/(?:api|v\d+)[a-z0-9/_:.-]*/gi) ?? [];
    for (const endpoint of endpointMatches) strings.push(endpoint);
    const codeMatches = value.match(/[a-z][a-z0-9_:-]{5,}/gi) ?? [];
    for (const code of codeMatches) strings.push(code);
    return strings;
  }
  if (typeof value !== "object") return strings;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) stringsFromValue(entry, strings);
    return strings;
  }
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    strings.push(key);
    stringsFromValue(entry, strings);
  }
  return strings;
}
