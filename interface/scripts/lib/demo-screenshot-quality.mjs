function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildCheck(name, ok, details, weight = 10, hardFailure = false) {
  return {
    name,
    ok,
    details,
    weight,
    hardFailure,
  };
}

function hasMeaningfulVisibleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().length >= 24;
}

function aspectRatioFromClip(clip) {
  if (!clip?.width || !clip?.height) {
    return null;
  }
  return clip.width / clip.height;
}

function coverageFromClip(viewport, clip) {
  if (!viewport?.width || !viewport?.height || !clip?.width || !clip?.height) {
    return null;
  }
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea <= 0) {
    return null;
  }
  return (clip.width * clip.height) / viewportArea;
}

export function assessDemoScreenshotQuality({
  phaseId = "unknown",
  viewport = null,
  screenshot = null,
  visibleText = "",
  validationMatches = [],
  minSignalMatches = 0,
  proofRequirements = [],
  proofRequirementMatches = [],
  requiredUiSignals = [],
  routeMatched = true,
  activeAppMatched = true,
  uiSignals = {},
  forbiddenToolCalls = [],
  forbiddenPhrases = [],
  forbiddenPhraseMatches = [],
} = {}) {
  const meaningfulText = hasMeaningfulVisibleText(visibleText);
  const clipAspectRatio = aspectRatioFromClip(screenshot?.clip);
  const clipCoverage = coverageFromClip(viewport, screenshot?.clip);
  const strictUnionCrop = screenshot?.kind === "surface-union" && Array.isArray(screenshot?.targets) && screenshot.targets.length >= 3;
  const maxRecommendedCoverage = screenshot?.kind === "surface-union" && Array.isArray(screenshot?.targets) && screenshot.targets.length >= 3
    ? 0.82
    : 0.95;
  const matchedSignals = Array.isArray(validationMatches) ? validationMatches.length : 0;
  const matchedProofRequirements = Array.isArray(proofRequirementMatches) ? proofRequirementMatches.length : 0;
  const missingRequiredUiSignals = (Array.isArray(requiredUiSignals) ? requiredUiSignals : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((signalName) => !uiSignals?.[signalName]);
  const blockedTools = Array.isArray(forbiddenToolCalls)
    ? forbiddenToolCalls.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const blockedPhrases = Array.isArray(forbiddenPhraseMatches)
    ? forbiddenPhraseMatches.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const checks = [];

  checks.push(
    buildCheck(
      "meaningful-text",
      meaningfulText,
      meaningfulText ? "visible text looks substantive" : "visible text is too sparse to prove the story",
      14,
      phaseId !== "setup-state",
    ),
  );

  if (minSignalMatches > 0) {
    checks.push(
      buildCheck(
        "signal-match",
        matchedSignals >= minSignalMatches,
        `${matchedSignals} validation signals matched (need ${minSignalMatches})`,
        16,
        phaseId !== "setup-state",
      ),
    );
  }

  if ((Array.isArray(proofRequirements) ? proofRequirements.length : 0) > 0) {
    checks.push(
      buildCheck(
        "proof-requirements",
        matchedProofRequirements >= proofRequirements.length,
        `${matchedProofRequirements} story-specific proof requirements matched (need ${proofRequirements.length})`,
        16,
        phaseId !== "setup-state",
      ),
    );
  }

  if (missingRequiredUiSignals.length > 0 || (Array.isArray(requiredUiSignals) && requiredUiSignals.length > 0)) {
    checks.push(
      buildCheck(
        "required-ui-state",
        missingRequiredUiSignals.length === 0,
        missingRequiredUiSignals.length === 0
          ? "required UI state is visible"
          : `missing required UI state(s): ${missingRequiredUiSignals.join(", ")}`,
        14,
        phaseId !== "setup-state",
      ),
    );
  }

  checks.push(
    buildCheck(
      "route-or-app-match",
      Boolean(routeMatched || activeAppMatched),
      routeMatched || activeAppMatched
        ? "route or active app matches the intended proof surface"
        : "neither route nor active app matches the intended proof surface",
      16,
      true,
    ),
  );

  if ((Array.isArray(forbiddenPhrases) ? forbiddenPhrases.length : 0) > 0) {
    checks.push(
      buildCheck(
        "forbidden-proof-phrase",
        blockedPhrases.length === 0,
        blockedPhrases.length === 0
          ? "no misleading placeholder proof phrase is visible"
          : `misleading proof phrase(s) visible: ${blockedPhrases.join("; ")}`,
        16,
        phaseId !== "setup-state",
      ),
    );
  }

  checks.push(
    buildCheck(
      "placeholder-surface",
      !uiSignals.placeholderVisible,
      uiSignals.placeholderVisible ? "a placeholder route is still visible" : "no placeholder route is visible",
      16,
      true,
    ),
  );

  checks.push(
    buildCheck(
      "empty-state",
      !uiSignals.emptyStateVisible,
      uiSignals.emptyStateVisible ? "an empty-state surface is still dominant" : "no empty-state surface is visible",
      12,
      phaseId !== "setup-state",
    ),
  );

  checks.push(
    buildCheck(
      "desktop-layout",
      !uiSignals.mobileLayoutVisible,
      uiSignals.mobileLayoutVisible ? "the page appears to be showing a mobile-specific layout" : "desktop layout is active",
      14,
      true,
    ),
  );

  checks.push(
    buildCheck(
      "runtime-error",
      !uiSignals.errorTextVisible,
      uiSignals.errorTextVisible ? "an error or crash message is visible on screen" : "no visible runtime error text detected",
      16,
      true,
    ),
  );

  checks.push(
    buildCheck(
      "forbidden-tool",
      blockedTools.length === 0,
      blockedTools.length === 0
        ? "no disallowed agent tools were used"
        : `agent used disallowed tool(s): ${blockedTools.join(", ")}`,
      16,
      true,
    ),
  );

  if (screenshot?.kind === "full-page") {
    checks.push(
      buildCheck(
        "composed-crop",
        meaningfulText && !uiSignals.placeholderVisible,
        meaningfulText
          ? "full-page screenshot accepted because the proof state is still substantive"
          : "full-page screenshot without strong proof content is likely too loose",
        8,
        false,
      ),
    );
  } else if (clipAspectRatio !== null && clipCoverage !== null) {
    checks.push(
      buildCheck(
        "composed-crop",
        clipAspectRatio >= 1.25 && clipAspectRatio <= 2.15 && clipCoverage >= 0.18 && clipCoverage <= maxRecommendedCoverage,
        `crop aspect ${clipAspectRatio.toFixed(2)}, coverage ${(clipCoverage * 100).toFixed(1)}% (max ${(maxRecommendedCoverage * 100).toFixed(0)}% for this shot)`,
        10,
        strictUnionCrop,
      ),
    );
  }

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
  const hardFailures = checks.filter((check) => check.hardFailure && !check.ok);
  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;

  return {
    ok: hardFailures.length === 0 && score >= (phaseId === "setup-state" ? 50 : 60),
    score: clamp(score, 0, 100),
    hardFailures,
    checks,
    derived: {
      meaningfulText,
      matchedSignals,
      matchedProofRequirements,
      missingRequiredUiSignals,
      clipAspectRatio,
      clipCoverage,
      forbiddenToolCalls: blockedTools,
      forbiddenPhraseMatches: blockedPhrases,
    },
  };
}
