const DEFAULT_SEED_CAPABILITIES = ["proof-data-populated"];

function normalizeString(value) {
  return String(value || "").trim();
}

function unique(values, limit = 32) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeString)
      .filter(Boolean),
  )].slice(0, limit);
}

function candidateText(candidate = {}) {
  return [
    candidate.title,
    candidate.reason,
    candidate.proofGoal,
    candidate.publicCaption,
    candidate.targetAppId,
    candidate.targetPath,
    ...(Array.isArray(candidate.changedFiles) ? candidate.changedFiles : []),
  ].filter(Boolean).join("\n").toLowerCase();
}

function inferSeedCapabilities(candidate = {}) {
  const capabilities = [...DEFAULT_SEED_CAPABILITIES];
  const appId = normalizeString(candidate.targetAppId);
  const targetPath = normalizeString(candidate.targetPath);
  const text = candidateText(candidate);

  if (appId) {
    capabilities.push(`app:${appId}`);
  }
  if (targetPath.includes(":projectId") || /^\/projects(?:\/|$)/.test(targetPath) || /\bproject\b/.test(text)) {
    capabilities.push("project-selected");
  }
  if (/\b(?:artifact|asset|gallery|generated|image|model|3d|viewer|preview)\b/.test(text)) {
    capabilities.push("asset-gallery-populated");
  }
  if (/\b(?:chat|message|conversation|model picker|skills?)\b/.test(text)) {
    capabilities.push("agent-chat-ready");
  }
  if (/\b(?:debug|run|timeline|logs?)\b/.test(text)) {
    capabilities.push("run-history-populated");
  }

  return capabilities;
}

export function normalizeCaptureSeedPlan(seedPlan = null, candidate = {}) {
  const explicit = seedPlan && typeof seedPlan === "object" ? seedPlan : {};
  const capabilities = unique([
    ...inferSeedCapabilities(candidate),
    ...(Array.isArray(explicit.capabilities) ? explicit.capabilities : []),
  ]);
  const requiredState = unique([
    ...(Array.isArray(explicit.requiredState) ? explicit.requiredState : []),
    ...(capabilities.includes("project-selected") ? ["A demo project is selected before capture."] : []),
    ...(capabilities.includes("proof-data-populated") ? ["The target surface has meaningful proof data instead of an empty/default state."] : []),
  ]);
  const readinessSignals = unique([
    ...(Array.isArray(explicit.readinessSignals) ? explicit.readinessSignals : []),
    "desktop shell is visible",
    "target app route is active",
    "no blocking modal or placeholder state is visible",
  ]);

  return {
    schemaVersion: 1,
    mode: normalizeString(explicit.mode) || "capture-demo-state",
    capabilities,
    requiredState,
    readinessSignals,
    notes: normalizeString(explicit.notes) || null,
  };
}
