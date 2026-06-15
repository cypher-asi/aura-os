export const INVESTIGATION_STATUS = Object.freeze({
  READY: "ready",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const INVESTIGATION_CONFIDENCE = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

const VALID_INVESTIGATION_STATUSES = new Set(Object.values(INVESTIGATION_STATUS));
const VALID_CONFIDENCE = new Set(Object.values(INVESTIGATION_CONFIDENCE));

export function normalizeRuntimeEnvironment(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function inferRuntimeEnvironment(environment) {
  const normalized = typeof environment === "string" ? environment.trim().toLowerCase() : "";
  if (normalized.startsWith("desktop-")) return "desktop-release";
  if (normalized === "production") return "production-api";
  if (normalized === "local") return "local-dev";
  return null;
}

export function recordRuntimeEnvironment(record) {
  return normalizeRuntimeEnvironment(
    record?.runtimeEnvironment ?? record?.runtime ?? inferRuntimeEnvironment(record?.environment),
  );
}

export function investigationKey(featureId, checkId, runtimeEnvironment = null) {
  const runtime = normalizeRuntimeEnvironment(runtimeEnvironment);
  return runtime ? `${featureId ?? ""}:${runtime}:${checkId ?? ""}` : `${featureId ?? ""}:${checkId ?? ""}`;
}

export function normalizeInvestigation(raw, generatedAt) {
  if (!raw || typeof raw !== "object") return null;
  const checkId = typeof raw.checkId === "string" ? raw.checkId.trim() : "";
  if (!checkId) return null;
  const featureId = typeof raw.featureId === "string" && raw.featureId.trim()
    ? raw.featureId.trim()
    : null;
  const runtimeEnvironment = recordRuntimeEnvironment(raw);
  const normalizedGeneratedAt = normalizeIsoDate(raw.generatedAt, generatedAt);

  return {
    schemaVersion: 1,
    kind: "llm-investigation",
    id: stringOrDefault(raw.id, investigationKey(featureId, checkId, runtimeEnvironment)),
    featureId,
    featureLabel: stringOrDefault(raw.featureLabel, featureId ?? "Unknown feature"),
    checkId,
    runtimeEnvironment,
    title: stringOrDefault(raw.title, "Investigator report"),
    status: VALID_INVESTIGATION_STATUSES.has(raw.status) ? raw.status : INVESTIGATION_STATUS.READY,
    checkStatus: typeof raw.checkStatus === "string" ? raw.checkStatus : null,
    featureStatus: typeof raw.featureStatus === "string" ? raw.featureStatus : null,
    generatedAt: normalizedGeneratedAt,
    environment: typeof raw.environment === "string" ? raw.environment : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    confidence: VALID_CONFIDENCE.has(raw.confidence) ? raw.confidence : INVESTIGATION_CONFIDENCE.LOW,
    summary: stringOrDefault(raw.summary, ""),
    rootCause: stringOrDefault(raw.rootCause, ""),
    proof: normalizeStringArray(raw.proof),
    possibleCauses: normalizeStringArray(raw.possibleCauses),
    reproductionSteps: normalizeStructuredList(raw.reproductionSteps),
    affectedAreas: normalizeStructuredList(raw.affectedAreas),
    recommendedNextActions: normalizeStringArray(raw.recommendedNextActions),
    recommendedVerifierProbes: normalizeStructuredList(raw.recommendedVerifierProbes),
    whatWouldDisproveThis: normalizeStringArray(raw.whatWouldDisproveThis),
    followUpEvals: normalizeStringArray(raw.followUpEvals),
    evidenceDigest: raw.evidenceDigest && typeof raw.evidenceDigest === "object" ? raw.evidenceDigest : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

export function latestInvestigationsByCheck(investigations, generatedAt) {
  const map = new Map();
  for (const raw of investigations ?? []) {
    const investigation = normalizeInvestigation(raw, generatedAt);
    if (!investigation) continue;
    const keys = investigation.runtimeEnvironment
      ? investigation.featureId
        ? [
          investigationKey(investigation.featureId, investigation.checkId, investigation.runtimeEnvironment),
          investigationKey(null, investigation.checkId, investigation.runtimeEnvironment),
        ]
        : [investigationKey(null, investigation.checkId, investigation.runtimeEnvironment)]
      : investigation.featureId
        ? [investigationKey(investigation.featureId, investigation.checkId)]
        : [investigationKey(null, investigation.checkId)];
    for (const key of keys) {
      const existing = map.get(key);
      if (!existing || new Date(investigation.generatedAt).getTime() > new Date(existing.generatedAt).getTime()) {
        map.set(key, investigation);
      }
    }
  }
  return map;
}

export function annotateInvestigation(investigation, { feature, checkConfig, verdict, environment, source }) {
  if (!investigation) return null;
  return {
    ...investigation,
    featureId: feature?.id ?? investigation.featureId,
    featureLabel: feature?.label ?? investigation.featureLabel,
    checkId: checkConfig?.id ?? investigation.checkId,
    runtimeEnvironment: verdict?.check?.runtimeEnvironment ?? investigation.runtimeEnvironment,
    checkStatus: verdict?.check?.status ?? investigation.checkStatus ?? "unknown",
    featureStatus: verdict?.status ?? investigation.featureStatus ?? "unknown",
    environment: environment ?? investigation.environment,
    source: source ?? investigation.source,
  };
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
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
}

function normalizeStructuredList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return { label: entry };
      if (!entry || typeof entry !== "object") return null;
      const label = stringOrDefault(entry.label, "");
      if (!label) return null;
      const normalized = { label };
      for (const key of ["command", "path", "reason", "details"]) {
        if (typeof entry[key] === "string" && entry[key].trim()) normalized[key] = entry[key].trim();
      }
      if (Array.isArray(entry.steps)) normalized.steps = normalizeStringArray(entry.steps);
      return normalized;
    })
    .filter(Boolean);
}
