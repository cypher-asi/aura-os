import { createHash } from "node:crypto";

import { buildInvestigationEvidencePacket } from "./status-investigation-packets.mjs";
import { INVESTIGATION_STATUS, normalizeInvestigation } from "./status-investigations.mjs";
import { redactSensitive as redactSensitiveValue } from "./status-redaction.mjs";
import { sourceNeedlesForCheck } from "./status-source-discovery.mjs";

export { redactSensitiveValue as redactSensitive };
export { sourceNeedlesForCheck };

export const INVESTIGATOR_SYSTEM_PROMPT = [
  "You are AURA's observability investigator.",
  "You receive a structured investigation packet with failing eval evidence, expected-output contracts, sibling check context, source discovery artifacts, and reproduction hints.",
  "Produce JSON only. Do not include markdown.",
  "Use only the supplied evidence and source discovery artifacts. If the root cause is uncertain, say so and explain what evidence would prove or disprove it.",
  "Do not invent file paths, commands, endpoints, or line numbers.",
  "Proof points should cite investigationPacket.evidenceItems ids when possible.",
  "Treat suspect commits or PRs as hypotheses. Do not call them causal unless the eval proof and source context support the link.",
  "Distinguish an eval failure from a user-facing product outage. Do not claim production users or real traffic are impacted unless the supplied evidence includes user-traffic or incident signals.",
  "If a broad health check passed but a specific endpoint or route failed, localize the diagnosis to that endpoint, route, version, or configuration instead of declaring the whole service down.",
  "Every report must include at least one proof point, possible cause, reproduction step, affected area, and recommended next action.",
  "Every report must also name what evidence would disprove the diagnosis and which verifier probes should run next.",
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
  sourceContext = [],
  sourceDiscovery = null,
  verifierContext = null,
}) {
  const investigationPacket = buildInvestigationEvidencePacket({
    check,
    feature,
    checkConfig,
    expectation,
    siblingChecks,
    sourceHints,
    sourceContext,
    sourceDiscovery,
    verifierContext,
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
    sourceContext,
    sourceDiscovery,
    verifierContext,
    responseSchema: {
      title: "Short investigator report title.",
      confidence: "low | medium | high",
      summary: "One or two sentences proving the visible failure.",
      rootCause: "Best evidence-backed root cause, or explicit uncertainty. Keep impact scoped to the eval evidence.",
      proof: ["Evidence points from the eval result or source discovery artifacts."],
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
          path: "Optional exact path from source discovery artifacts",
          reason: "Why this area is implicated",
        },
      ],
      whatWouldDisproveThis: ["Evidence that would weaken or falsify the proposed root cause."],
      recommendedVerifierProbes: [
        {
          label: "Safe verifier probe to run next",
          command: "Optional command if directly supported by supplied evidence",
          reason: "Why this probe would confirm or rule out the diagnosis",
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
  sourceContext = [],
  sourceDiscovery = null,
  verifierContext = null,
  generatedAt = new Date().toISOString(),
  environment = "unknown",
  source = "aura-status",
  provider,
  model,
  callModel,
}) {
  const input = buildInvestigationInput({
    check,
    feature,
    checkConfig,
    expectation,
    siblingChecks,
    sourceHints,
    sourceContext,
    sourceDiscovery,
    verifierContext,
  });
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
            content: `The previous report was missing required non-empty fields: ${missing.join(", ")}. Return the same structured report again, but fill every missing field using only the supplied evidence and source discovery artifacts.`,
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
  if (!Array.isArray(investigation?.whatWouldDisproveThis) || investigation.whatWouldDisproveThis.length === 0) {
    missing.push("whatWouldDisproveThis");
  }
  if (!Array.isArray(investigation?.recommendedVerifierProbes) || investigation.recommendedVerifierProbes.length === 0) {
    missing.push("recommendedVerifierProbes");
  }
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
