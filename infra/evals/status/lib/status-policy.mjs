export const FEATURE_STATUS = Object.freeze({
  OPERATIONAL: "operational",
  DEGRADED: "degraded",
  PARTIAL_OUTAGE: "partial_outage",
  MAJOR_OUTAGE: "major_outage",
  UNKNOWN: "unknown",
  MAINTENANCE: "maintenance",
});

export const CHECK_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
  SKIP: "skip",
});

const FEATURE_SEVERITY = Object.freeze({
  [FEATURE_STATUS.OPERATIONAL]: 0,
  [FEATURE_STATUS.MAINTENANCE]: 1,
  [FEATURE_STATUS.UNKNOWN]: 2,
  [FEATURE_STATUS.DEGRADED]: 3,
  [FEATURE_STATUS.PARTIAL_OUTAGE]: 4,
  [FEATURE_STATUS.MAJOR_OUTAGE]: 5,
});

export function normalizeIsoDate(value, fallback = null) {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

export function minutesBetween(leftIso, rightIso) {
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.max(0, (right - left) / 60000);
}

export function normalizeCheckResult(raw, generatedAt) {
  const checkId = typeof raw?.checkId === "string" ? raw.checkId : "";
  const status = Object.values(CHECK_STATUS).includes(raw?.status) ? raw.status : CHECK_STATUS.FAIL;
  const endedAt = normalizeIsoDate(raw?.endedAt, normalizeIsoDate(raw?.checkedAt, generatedAt));
  const startedAt = normalizeIsoDate(raw?.startedAt, endedAt);
  const latencyMs = Number.isFinite(Number(raw?.latencyMs)) ? Math.max(0, Number(raw.latencyMs)) : null;

  return {
    checkId,
    featureId: typeof raw?.featureId === "string" ? raw.featureId : null,
    label: typeof raw?.label === "string" ? raw.label : checkId,
    status,
    message: typeof raw?.message === "string" ? raw.message : "",
    startedAt,
    endedAt,
    latencyMs,
    environment: typeof raw?.environment === "string" ? raw.environment : null,
    evidence: raw?.evidence && typeof raw.evidence === "object" ? raw.evidence : {},
  };
}

function latestByCheckId(checks, generatedAt) {
  const map = new Map();
  for (const raw of checks) {
    const check = normalizeCheckResult(raw, generatedAt);
    if (!check.checkId) continue;
    const existing = map.get(check.checkId);
    if (!existing || new Date(check.endedAt).getTime() > new Date(existing.endedAt).getTime()) {
      map.set(check.checkId, check);
    }
  }
  return map;
}

function checkVerdict(check, config, generatedAt) {
  if (!check) {
    return {
      status: FEATURE_STATUS.UNKNOWN,
      reason: "No recent result",
      stale: true,
      check: null,
    };
  }

  const staleAfterMinutes = Number(config.staleAfterMinutes ?? 15);
  const ageMinutes = minutesBetween(check.endedAt, generatedAt);
  if (ageMinutes > staleAfterMinutes) {
    return {
      status: FEATURE_STATUS.UNKNOWN,
      reason: `Last result is ${Math.round(ageMinutes)}m old`,
      stale: true,
      check,
    };
  }

  const warningLatencyMs = Number(config.warningLatencyMs ?? Infinity);
  const outageLatencyMs = Number(config.outageLatencyMs ?? Infinity);

  if (check.status === CHECK_STATUS.FAIL) {
    return {
      status: config.required === false ? FEATURE_STATUS.DEGRADED : FEATURE_STATUS.PARTIAL_OUTAGE,
      reason: check.message || "Check failed",
      stale: false,
      check,
    };
  }

  if (check.status === CHECK_STATUS.WARN) {
    return {
      status: FEATURE_STATUS.DEGRADED,
      reason: check.message || "Check returned warning",
      stale: false,
      check,
    };
  }

  if (check.status === CHECK_STATUS.SKIP) {
    return {
      status: config.required === false ? FEATURE_STATUS.OPERATIONAL : FEATURE_STATUS.UNKNOWN,
      reason: check.message || "Check skipped",
      stale: false,
      check,
    };
  }

  if (check.latencyMs != null && check.latencyMs >= outageLatencyMs) {
    return {
      status: FEATURE_STATUS.PARTIAL_OUTAGE,
      reason: `Latency ${Math.round(check.latencyMs)}ms exceeded outage threshold`,
      stale: false,
      check,
    };
  }

  if (check.latencyMs != null && check.latencyMs >= warningLatencyMs) {
    return {
      status: FEATURE_STATUS.DEGRADED,
      reason: `Latency ${Math.round(check.latencyMs)}ms exceeded warning threshold`,
      stale: false,
      check,
    };
  }

  return {
    status: FEATURE_STATUS.OPERATIONAL,
    reason: check.message || "Check passed",
    stale: false,
    check,
  };
}

function statusMax(left, right) {
  return FEATURE_SEVERITY[left] >= FEATURE_SEVERITY[right] ? left : right;
}

export function aggregateFeature(feature, checkMap, generatedAt) {
  const checkConfigs = Array.isArray(feature.checks) ? feature.checks : [];
  const verdicts = checkConfigs.map((config) =>
    checkVerdict(checkMap.get(config.id), config, generatedAt),
  );
  const requiredVerdicts = verdicts.filter((verdict, index) => checkConfigs[index]?.required !== false);
  const presentRequired = requiredVerdicts.filter((verdict) => verdict.check != null);
  const failedRequired = requiredVerdicts.filter((verdict) =>
    verdict.status === FEATURE_STATUS.PARTIAL_OUTAGE || verdict.status === FEATURE_STATUS.MAJOR_OUTAGE,
  );
  const degraded = verdicts.filter((verdict) => verdict.status === FEATURE_STATUS.DEGRADED);
  const unknownRequired = requiredVerdicts.filter((verdict) => verdict.status === FEATURE_STATUS.UNKNOWN);
  const outageAfterFailures = Number(feature.outageAfterFailures ?? (requiredVerdicts.length || 1));
  const degradedAfterFailures = Number(feature.degradedAfterFailures ?? 1);

  let status = FEATURE_STATUS.OPERATIONAL;
  if (requiredVerdicts.length > 0 && presentRequired.length === 0) {
    status = FEATURE_STATUS.UNKNOWN;
  }
  if (unknownRequired.length > 0) {
    status = statusMax(status, FEATURE_STATUS.UNKNOWN);
  }
  if (degraded.length >= degradedAfterFailures) {
    status = statusMax(status, FEATURE_STATUS.DEGRADED);
  }
  if (failedRequired.length > 0) {
    status = statusMax(status, FEATURE_STATUS.PARTIAL_OUTAGE);
  }
  if (failedRequired.length >= outageAfterFailures) {
    status = FEATURE_STATUS.MAJOR_OUTAGE;
  }

  const passCount = verdicts.filter((verdict) => verdict.check?.status === CHECK_STATUS.PASS).length;
  const checkedCount = verdicts.filter((verdict) => verdict.check != null).length;
  const minPassRate = Number(feature.minPassRate ?? 0);
  if (checkedCount > 0 && minPassRate > 0 && passCount / checkedCount < minPassRate) {
    status = statusMax(status, FEATURE_STATUS.DEGRADED);
  }

  const latestAt = verdicts
    .map((verdict) => verdict.check?.endedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const latencies = verdicts
    .map((verdict) => verdict.check?.latencyMs)
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  const p95Index = latencies.length > 0 ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : -1;

  return {
    id: feature.id,
    label: feature.label,
    category: feature.category,
    priority: Number(feature.priority ?? 999),
    description: feature.description,
    publicSummary: feature.publicSummary,
    status,
    lastCheckedAt: latestAt,
    checksPassed: passCount,
    checksTotal: checkConfigs.length,
    checksFailed: verdicts.filter((verdict) => verdict.check?.status === CHECK_STATUS.FAIL).length,
    checksUnknown: verdicts.filter((verdict) => verdict.status === FEATURE_STATUS.UNKNOWN).length,
    latencyP95Ms: p95Index >= 0 ? latencies[p95Index] : null,
    message: featureMessage(status, verdicts),
    checks: verdicts.map((verdict, index) => ({
      id: checkConfigs[index].id,
      required: checkConfigs[index].required !== false,
      status: verdict.check?.status ?? "unknown",
      featureStatus: verdict.status,
      message: verdict.reason,
      checkedAt: verdict.check?.endedAt ?? null,
      latencyMs: verdict.check?.latencyMs ?? null,
      evidence: verdict.check?.evidence ?? {},
    })),
  };
}

function featureMessage(status, verdicts) {
  if (status === FEATURE_STATUS.OPERATIONAL) return "All required checks are passing.";
  const blocking = verdicts.find((verdict) => verdict.status === status)
    ?? [...verdicts].sort((left, right) => FEATURE_SEVERITY[right.status] - FEATURE_SEVERITY[left.status])[0];
  return blocking?.reason ?? "Feature health needs attention.";
}

export function buildStatusSnapshot({ registry, checks = [], generatedAt = new Date().toISOString(), environment = "unknown", source = "aura-status" }) {
  const normalizedGeneratedAt = normalizeIsoDate(generatedAt, new Date().toISOString());
  const checkMap = latestByCheckId(checks, normalizedGeneratedAt);
  const features = [...(registry.features ?? [])]
    .map((feature) => aggregateFeature(feature, checkMap, normalizedGeneratedAt))
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));

  const overall = features.reduce(
    (current, feature) => statusMax(current, feature.status),
    FEATURE_STATUS.OPERATIONAL,
  );

  return {
    schemaVersion: 1,
    title: registry.title ?? "Aura Observability",
    description: registry.description ?? "",
    generatedAt: normalizedGeneratedAt,
    environment,
    source,
    overall,
    totals: {
      features: features.length,
      operational: features.filter((feature) => feature.status === FEATURE_STATUS.OPERATIONAL).length,
      degraded: features.filter((feature) => feature.status === FEATURE_STATUS.DEGRADED).length,
      partialOutage: features.filter((feature) => feature.status === FEATURE_STATUS.PARTIAL_OUTAGE).length,
      majorOutage: features.filter((feature) => feature.status === FEATURE_STATUS.MAJOR_OUTAGE).length,
      unknown: features.filter((feature) => feature.status === FEATURE_STATUS.UNKNOWN).length,
      maintenance: features.filter((feature) => feature.status === FEATURE_STATUS.MAINTENANCE).length,
    },
    features,
  };
}
