import { readPath } from "./check-expectations.mjs";
import { redactSensitive } from "./status-redaction.mjs";

export function buildInvestigationEvidencePacket({
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
  const requiredEvidence = Array.isArray(expectation?.requiredEvidence) ? expectation.requiredEvidence : [];
  const failedEvidence = check?.evidence && typeof check.evidence === "object" ? check.evidence : {};
  const missingRequiredEvidence = requiredEvidence.filter((path) => {
    const value = readPath(failedEvidence, path);
    return value === undefined || value === null;
  });
  const presentRequiredEvidence = requiredEvidence.filter((path) => !missingRequiredEvidence.includes(path));
  const siblingSummaries = summarizeSiblings(check, siblingChecks);

  return redactSensitive({
    schemaVersion: 1,
    packetKind: "aura-observability-investigation-packet",
    investigationRules: [
      "Treat this packet as evidence, not a conclusion.",
      "Cite evidence item ids when writing proof.",
      "Distinguish eval infrastructure failures from user-facing incidents unless traffic or incident evidence is present.",
      "Prefer the earliest violated contract, endpoint, runtime, or config boundary over the most visible downstream symptom.",
      "Treat sourceDiscovery.suspectChanges as regression hypotheses, not proof of causality without supporting eval and source evidence.",
    ],
    feature: {
      id: feature?.id ?? check?.featureId ?? null,
      label: feature?.label ?? null,
      category: feature?.category ?? null,
      description: feature?.description ?? null,
      publicSummary: feature?.publicSummary ?? null,
    },
    checkContract: {
      id: checkConfig?.id ?? check?.checkId ?? null,
      label: check?.label ?? checkConfig?.label ?? check?.checkId ?? null,
      required: checkConfig?.required !== false,
      warningLatencyMs: checkConfig?.warningLatencyMs ?? null,
      outageLatencyMs: checkConfig?.outageLatencyMs ?? null,
      expectedOutput: expectation
        ? {
          description: expectation.description ?? null,
          requiredEvidence,
          assertions: Array.isArray(expectation.assertions) ? expectation.assertions : [],
        }
        : null,
      presentRequiredEvidence,
      missingRequiredEvidence,
    },
    failedCheck: {
      checkId: check?.checkId ?? null,
      featureId: check?.featureId ?? null,
      status: check?.status ?? null,
      message: check?.message ?? "",
      startedAt: check?.startedAt ?? null,
      endedAt: check?.endedAt ?? null,
      runGeneratedAt: check?.runGeneratedAt ?? null,
      latencyMs: check?.latencyMs ?? null,
      environment: check?.environment ?? null,
      evidence: failedEvidence,
    },
    siblingPattern: siblingSummaries.pattern,
    siblingChecks: siblingSummaries.checks,
    verifierContext,
    sourceDiscovery,
    evidenceItems: buildEvidenceItems({
      check,
      expectation,
      missingRequiredEvidence,
      siblingChecks: siblingSummaries.checks,
      sourceHints,
      sourceContext,
      sourceDiscovery,
    }),
    reproductionHint: {
      label: `Run only ${check?.checkId ?? "this check"}`,
      command: check?.checkId ? `AURA_STATUS_CHECKS=${check.checkId} npm run status:probes` : "npm run status:probes",
      details: "Use the same environment variables as the scheduled observability workflow.",
    },
    sourceHints,
    sourceContext,
    sourceDiscovery,
  });
}

function summarizeSiblings(check, siblingChecks) {
  const normalizedMessage = normalizeMessage(check?.message);
  const checks = siblingChecks.map((sibling) => ({
    checkId: sibling.checkId,
    featureId: sibling.featureId,
    status: sibling.status,
    message: sibling.message,
    endedAt: sibling.endedAt,
    latencyMs: sibling.latencyMs,
    sameMessage: Boolean(normalizedMessage && normalizeMessage(sibling.message) === normalizedMessage),
    evidenceKeys: Object.keys(sibling.evidence ?? {}).sort(),
  }));
  const failed = checks.filter((sibling) => sibling.status === "fail").map((sibling) => sibling.checkId);
  const warned = checks.filter((sibling) => sibling.status === "warn").map((sibling) => sibling.checkId);
  const passed = checks.filter((sibling) => sibling.status === "pass").map((sibling) => sibling.checkId);
  const sameMessage = checks.filter((sibling) => sibling.sameMessage).map((sibling) => sibling.checkId);

  return {
    checks,
    pattern: {
      failed,
      warned,
      passed,
      sameMessage,
      allFailingSiblingsShareMessage: failed.length > 0 && sameMessage.length === failed.length,
    },
  };
}

function buildEvidenceItems({
  check,
  expectation,
  missingRequiredEvidence,
  siblingChecks,
  sourceHints,
  sourceContext,
  sourceDiscovery,
}) {
  const items = [];
  addEvidenceItem(items, {
    id: "failed-check.message",
    kind: "check-message",
    summary: check?.message ?? "",
  });
  addEvidenceItem(items, {
    id: "failed-check.timing",
    kind: "timing",
    summary: `status=${check?.status ?? "unknown"} latencyMs=${check?.latencyMs ?? "unknown"} endedAt=${check?.endedAt ?? "unknown"}`,
  });
  addEvidenceItem(items, {
    id: "failed-check.evidence",
    kind: "raw-evidence",
    summary: check?.evidence ?? {},
  });
  if (expectation) {
    addEvidenceItem(items, {
      id: "expected-output.contract",
      kind: "expected-output-contract",
      summary: {
        description: expectation.description ?? null,
        requiredEvidence: expectation.requiredEvidence ?? [],
        assertions: expectation.assertions ?? [],
      },
    });
  }
  if (missingRequiredEvidence.length > 0) {
    addEvidenceItem(items, {
      id: "expected-output.missing-required-evidence",
      kind: "contract-gap",
      summary: missingRequiredEvidence,
    });
  }
  for (const sibling of siblingChecks.slice(0, 12)) {
    addEvidenceItem(items, {
      id: `sibling.${sibling.checkId}`,
      kind: "sibling-check",
      summary: sibling,
    });
  }
  for (const hint of sourceHints.slice(0, 12)) {
    addEvidenceItem(items, {
      id: hint.path && hint.line ? `source.${hint.path}:${hint.line}` : `source.${hint.id ?? hint.kind ?? "hint"}`,
      kind: "source-hint",
      summary: hint,
    });
  }
  for (const context of sourceContext.slice(0, 8)) {
    addEvidenceItem(items, {
      id: `source-context.${context.path}:${context.startLine}-${context.endLine}`,
      kind: "source-context",
      summary: context,
    });
  }
  for (const change of sourceDiscovery?.recentChanges?.slice(0, 8) ?? []) {
    addEvidenceItem(items, {
      id: `recent-change.${change.path}`,
      kind: "recent-change",
      summary: change,
    });
  }
  for (const change of sourceDiscovery?.suspectChanges?.slice(0, 8) ?? []) {
    addEvidenceItem(items, {
      id: `suspect-change.${change.shortCommit ?? change.commit}`,
      kind: "suspect-change",
      summary: change,
    });
  }
  if (sourceDiscovery?.rankedPaths?.length > 0) {
    addEvidenceItem(items, {
      id: "source-discovery.ranked-paths",
      kind: "source-discovery-summary",
      summary: {
        byKind: sourceDiscovery.byKind ?? {},
        rankedPaths: sourceDiscovery.rankedPaths,
        candidateCodePaths: sourceDiscovery.candidateCodePaths ?? [],
        suspectChanges: sourceDiscovery.suspectChanges ?? [],
      },
    });
  }
  return items;
}

function addEvidenceItem(items, item) {
  if (!item.summary || (typeof item.summary === "string" && !item.summary.trim())) return;
  items.push(item);
}

function normalizeMessage(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, "<timestamp>").trim().toLowerCase();
}
