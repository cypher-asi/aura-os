import { readPath, validateCheckEvidence } from "./check-expectations.mjs";
import { redactSensitive } from "./status-redaction.mjs";

export function buildInvestigationVerifierContext({
  check,
  expectation,
  siblingChecks = [],
  previousChecks = [],
  sourceHints = [],
  sourceContext = [],
  sourceDiscovery = null,
}) {
  const requiredEvidence = Array.isArray(expectation?.requiredEvidence) ? expectation.requiredEvidence : [];
  const evidence = check?.evidence && typeof check.evidence === "object" ? check.evidence : {};
  const missingRequiredEvidence = requiredEvidence.filter((path) => {
    const value = readPath(evidence, path);
    return value === undefined || value === null;
  });
  const presentRequiredEvidence = requiredEvidence.filter((path) => !missingRequiredEvidence.includes(path));
  const contractValidationError = expectation
    ? validateCheckEvidence(check?.checkId, check, { checks: { [check?.checkId]: expectation } })
    : null;

  const sameMessageSiblingIds = siblingChecks
    .filter((sibling) => normalizeMessage(sibling.message) === normalizeMessage(check?.message))
    .map(checkRef);
  const failedSiblingIds = siblingChecks
    .filter((sibling) => sibling.status === "fail")
    .map(checkRef);
  const passingSiblingIds = siblingChecks
    .filter((sibling) => sibling.status === "pass")
    .map(checkRef);
  const sourcePaths = [...new Set([
    ...sourceHints.map((hint) => hint.path).filter(Boolean),
    ...sourceContext.map((context) => context.path).filter(Boolean),
  ])].slice(0, 12);

  return redactSensitive({
    schemaVersion: 1,
    verifierKind: "aura-observability-investigation-verifier-context",
    contract: {
      presentRequiredEvidence,
      missingRequiredEvidence,
      contractValidationError,
      expectedEvidenceCount: requiredEvidence.length,
    },
    siblingCorrelation: {
      failedSiblingIds,
      passingSiblingIds,
      sameMessageSiblingIds,
      likelySharedDependencyFailure: failedSiblingIds.length > 0 && sameMessageSiblingIds.length === failedSiblingIds.length,
    },
    history: summarizeHistory(check, previousChecks),
    sourceContext: {
      sourceHintCount: sourceHints.length,
      sourcePaths,
      excerpts: sourceContext.slice(0, 8),
      rankedPaths: sourceDiscovery?.rankedPaths ?? [],
      candidateCodePaths: sourceDiscovery?.candidateCodePaths ?? [],
      recentChanges: sourceDiscovery?.recentChanges ?? [],
      suspectChanges: sourceDiscovery?.suspectChanges ?? [],
    },
    recommendedVerifierProbes: recommendedVerifierProbes({
      check,
      missingRequiredEvidence,
      contractValidationError,
      failedSiblingIds,
      sameMessageSiblingIds,
      sourcePaths,
      sourceDiscovery,
      previousChecks,
    }),
  });
}

function summarizeHistory(check, previousChecks) {
  const sorted = previousChecks
    .filter((candidate) => candidate.checkId === check?.checkId)
    .sort((left, right) => new Date(right.endedAt ?? 0).getTime() - new Date(left.endedAt ?? 0).getTime())
    .slice(0, 8);
  const previousStatuses = sorted.map((entry) => ({
    status: entry.status,
    endedAt: entry.endedAt,
    latencyMs: entry.latencyMs ?? null,
    message: entry.message ?? "",
  }));
  const lastPassing = sorted.find((entry) => entry.status === "pass") ?? null;
  const lastFailing = sorted.find((entry) => entry.status === "fail") ?? null;

  return {
    previousRunCount: sorted.length,
    previousStatuses,
    lastPassingAt: lastPassing?.endedAt ?? null,
    lastFailingAt: lastFailing?.endedAt ?? null,
    currentlyRegressedFromPass: check?.status !== "pass" && Boolean(lastPassing),
  };
}

function recommendedVerifierProbes({
  check,
  missingRequiredEvidence,
  contractValidationError,
  failedSiblingIds,
  sameMessageSiblingIds,
  sourcePaths,
  sourceDiscovery,
  previousChecks,
}) {
  const probes = [];
  if (missingRequiredEvidence.length > 0 || contractValidationError) {
    probes.push({
      label: "Re-run the failed expected-output contract",
      command: reproductionCommand(check),
      reason: contractValidationError ?? `Missing required evidence: ${missingRequiredEvidence.join(", ")}`,
    });
  }
  if (failedSiblingIds.length > 0 && sameMessageSiblingIds.length === failedSiblingIds.length) {
    probes.push({
      label: "Investigate the shared upstream dependency before individual check code",
      reason: `Sibling checks failed with the same message: ${sameMessageSiblingIds.join(", ")}`,
    });
  }
  if (sourcePaths.length > 0) {
    probes.push({
      label: "Inspect implicated source paths",
      reason: sourcePaths.join(", "),
    });
  }
  if (sourceDiscovery?.recentChanges?.length > 0) {
    probes.push({
      label: "Review recent commits for implicated source paths",
      reason: sourceDiscovery.recentChanges
        .slice(0, 3)
        .map((change) => `${change.path}: ${change.commits?.[0] ?? "recent commit"}`)
        .join("; "),
    });
  }
  if (sourceDiscovery?.suspectChanges?.length > 0) {
    probes.push({
      label: "Check suspect changes against eval proof",
      reason: sourceDiscovery.suspectChanges
        .slice(0, 3)
        .map((change) => `${change.shortCommit ?? change.commit}: ${change.reasons?.[0] ?? change.subject ?? "suspect change"}`)
        .join("; "),
    });
  }
  if (previousChecks.some((entry) => entry.status === "pass")) {
    probes.push({
      label: "Compare with the most recent passing run",
      reason: "A previous pass exists for this check, so the failure may be a regression or environment drift.",
    });
  }
  return probes;
}

function reproductionCommand(check) {
  if (!check?.checkId) return "npm run status:probes";
  const runtimePrefix = check.runtimeEnvironment
    ? `AURA_STATUS_RUNTIME_ENVIRONMENT=${check.runtimeEnvironment} `
    : "";
  return `${runtimePrefix}AURA_STATUS_CHECKS=${check.checkId} npm run status:probes`;
}

function checkRef(check) {
  return check?.runtimeEnvironment ? `${check.runtimeEnvironment}/${check.checkId}` : check?.checkId;
}

function normalizeMessage(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, "<timestamp>").trim().toLowerCase();
}
