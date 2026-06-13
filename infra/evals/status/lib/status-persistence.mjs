import { promises as fs } from "node:fs";

export function buildObservabilityIngestPayload(snapshot, metadata = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("snapshot must be a JSON object");
  }
  if (!Array.isArray(snapshot.features) || snapshot.features.length === 0) {
    throw new Error("snapshot.features must be a non-empty array");
  }
  if (typeof snapshot.generatedAt !== "string" || snapshot.generatedAt.length === 0) {
    throw new Error("snapshot.generatedAt is required");
  }

  const externalRunAttempt = Number(metadata.externalRunAttempt ?? 1);
  return pruneNullish({
    snapshot,
    source: stringOr(metadata.source, snapshot.source, "aura-status"),
    environment: stringOr(metadata.environment, snapshot.environment, "unknown"),
    externalRunId: optionalString(metadata.externalRunId),
    externalRunAttempt: Number.isFinite(externalRunAttempt) ? Math.max(1, Math.trunc(externalRunAttempt)) : 1,
    gitSha: optionalString(metadata.gitSha),
    gitBranch: optionalString(metadata.gitBranch),
    workflowName: optionalString(metadata.workflowName),
    releaseChannel: optionalString(metadata.releaseChannel),
    generatedAt: snapshot.generatedAt,
    completedAt: optionalString(metadata.completedAt),
    overallStatus: optionalString(snapshot.overall),
    totals: snapshot.totals && typeof snapshot.totals === "object" ? snapshot.totals : undefined,
  });
}

export async function readSnapshot(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function persistObservabilityRun({ storageUrl, token, payload, timeoutMs = 30_000 }) {
  if (!storageUrl) throw new Error("storageUrl is required");
  if (!token) throw new Error("token is required");

  const url = `${storageUrl.replace(/\/+$/, "")}/internal/observability/runs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

function stringOr(...values) {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return "";
}

function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function pruneNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}
