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

const UNPUBLISHABLE_EMPTY_STATE_PHRASES = [
  "Your generated image will appear here",
  "Generated images will appear here",
  "Your generated model will appear here",
  "Generated models will appear here",
  "Your generated asset will appear here",
  "Generated assets will appear here",
  "No generated images yet",
  "No generated models yet",
];

const GENERIC_PROOF_TOKENS = new Set([
  "app",
  "apps",
  "asset",
  "assets",
  "demo",
  "generated",
  "generation",
  "image",
  "images",
  "model",
  "models",
  "org",
  "project",
  "search",
  "surface",
  "tab",
  "tabs",
  "test",
  "view",
  "will",
  "your",
]);

function normalizeTextForQuality(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectUnpublishableEmptyStateMatches(visibleText) {
  const normalizedVisible = normalizeTextForQuality(visibleText);
  return UNPUBLISHABLE_EMPTY_STATE_PHRASES.filter((phrase) => {
    const normalizedPhrase = normalizeTextForQuality(phrase);
    return normalizedPhrase && normalizedVisible.includes(normalizedPhrase);
  });
}

function countSubstantiveTokens(values) {
  return Array.from(new Set(
    values
      .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9.]+/g))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !GENERIC_PROOF_TOKENS.has(token)),
  )).length;
}

function hasSubstantiveProductProofText({ visibleText, validationMatches = [], proofRequirementMatches = [] }) {
  const matchedProofPhrases = (Array.isArray(proofRequirementMatches) ? proofRequirementMatches : [])
    .flatMap((entry) => [entry?.matchedPhrase, entry?.label])
    .filter(Boolean);
  const values = [
    visibleText,
    ...(Array.isArray(validationMatches) ? validationMatches : []),
    ...matchedProofPhrases,
  ];

  if (/\b(?:gpt|claude|zero|webgl|jsonl|run id|copy all|billing|feedback|comment|skill|permission|login)\b/i.test(values.join(" "))) {
    return true;
  }

  return countSubstantiveTokens(values) >= 3;
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
  const requiredSidekickProof = Array.isArray(requiredUiSignals)
    && requiredUiSignals.includes("sidekickVisible")
    && uiSignals?.sidekickVisible
    && screenshot?.kind === "surface-union"
    && Array.isArray(screenshot?.targets)
    && screenshot.targets.includes("sidekick-panel");
  const strictUnionCrop = screenshot?.kind === "surface-union" && Array.isArray(screenshot?.targets) && screenshot.targets.length >= 3;
  const maxRecommendedCoverage = requiredSidekickProof
    ? 0.92
    : screenshot?.kind === "surface-union" && Array.isArray(screenshot?.targets) && screenshot.targets.length >= 3
      ? 0.82
    : 0.95;
  const matchedSignals = Array.isArray(validationMatches) ? validationMatches.length : 0;
  const matchedProofRequirements = Array.isArray(proofRequirementMatches) ? proofRequirementMatches.length : 0;
  const surfaceMatched = Boolean(routeMatched || activeAppMatched);
  const proofContentVisible = meaningfulText
    && surfaceMatched
    && (
      matchedProofRequirements > 0
      || (minSignalMatches > 0 && matchedSignals >= minSignalMatches)
    );
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
  const unpublishableEmptyStateMatches = collectUnpublishableEmptyStateMatches(visibleText);
  const substantiveProductProofText = hasSubstantiveProductProofText({
    visibleText,
    validationMatches,
    proofRequirementMatches,
  });
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
      surfaceMatched,
      surfaceMatched
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
      "empty-product-placeholder",
      unpublishableEmptyStateMatches.length === 0,
      unpublishableEmptyStateMatches.length === 0
        ? "no generated-product placeholder text is visible"
        : `generated-product placeholder text is visible: ${unpublishableEmptyStateMatches.join("; ")}`,
      18,
      phaseId !== "setup-state",
    ),
  );

  checks.push(
    buildCheck(
      "substantive-product-proof",
      substantiveProductProofText,
      substantiveProductProofText
        ? "visible text includes substantive product proof beyond generic shell labels"
        : "visible text is mostly generic shell, tab, project, or empty-canvas labels",
      14,
      phaseId !== "setup-state",
    ),
  );

  checks.push(
    buildCheck(
      "placeholder-surface",
      !uiSignals.placeholderVisible || proofContentVisible,
      uiSignals.placeholderVisible
        ? proofContentVisible
          ? "placeholder text exists elsewhere, but the proof crop has matching product content"
          : "a placeholder route is still visible"
        : "no placeholder route is visible",
      16,
      true,
    ),
  );

  checks.push(
    buildCheck(
      "empty-state",
      !uiSignals.emptyStateVisible || proofContentVisible,
      uiSignals.emptyStateVisible
        ? proofContentVisible
          ? "empty-state text exists elsewhere, but the proof crop has matching product content"
          : "an empty-state surface is still dominant"
        : "no empty-state surface is visible",
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
      unpublishableEmptyStateMatches,
      substantiveProductProofText,
    },
  };
}
