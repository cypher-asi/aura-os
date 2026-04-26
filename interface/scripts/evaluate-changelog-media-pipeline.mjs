#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  buildAuraNavigationContract,
  buildAuraNavigationSitemap,
} from "./lib/aura-navigation-contract.mjs";
import {
  extractChangelogMediaEntries,
  planChangelogMediaWithAnthropic,
} from "./lib/changelog-media-planner.mjs";
import { normalizeCaptureSeedPlan } from "./lib/changelog-media-seed-plan.mjs";
import { loadChangelogMediaKnowledge } from "./lib/changelog-media-knowledge.mjs";
import { resolveDemoRepoPath } from "./lib/demo-repo-paths.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  DEFAULT_BROWSER_USE_MODEL,
  DEFAULT_BROWSER_USE_INTERVAL_MS,
  DEFAULT_BROWSER_USE_TIMEOUT_MS,
  buildBrowserUseTask,
  buildCaptureLoginUrl,
  evaluateDesktopCapture,
  redactCaptureLoginSecrets,
  runBrowserUseTask,
} from "./changelog-media-browser-use-trial.mjs";
import {
  assessBrandedMediaAsset,
  createOpenAIProductionMediaImage,
} from "./lib/changelog-media-branding.mjs";
import {
  assessChangelogMediaQuality,
  judgeChangelogMediaWithOpenAI,
} from "./lib/changelog-media-quality.mjs";
import {
  captureHighResolutionAuraProof,
} from "./lib/changelog-media-highres-capture.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) index += 1;
    args[key] = value;
  }
  return args;
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isDisabled(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function uniqueOrigins(values) {
  return [...new Set(values.map(normalizeOrigin).filter(Boolean))];
}

function extractLinkedScriptPaths(html) {
  return [...String(html || "").matchAll(/(?:src|href)=["']([^"']+\.js)["']/gi)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 40);
}

function extractHttpOrigins(body) {
  return uniqueOrigins([...String(body || "").matchAll(/https?:\/\/[^\s"'`<>)\\]+/gi)].map((match) => match[0]));
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url).catch(() => null);
  if (!response?.ok || typeof response.text !== "function") return "";
  return response.text();
}

async function looksLikeAuraApiOrigin(origin, fetchImpl = fetch) {
  if (!origin) return false;
  const response = await fetchImpl(new URL("/api/auth/session", origin).toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!response) return false;
  const contentType = response.headers?.get?.("content-type") || "";
  return contentType.includes("application/json") && response.status !== 404;
}

function isOpusQualityModel(model) {
  return /^claude[-_]opus(?:[-_.]|$)/i.test(String(model || "").trim());
}

function isOpenAIQualityVisionModel(model) {
  return /^gpt[-_](?:5|4\.1|4o)(?:[-_.]|$)/i.test(String(model || "").trim());
}

export function assessMediaModelQuality({
  anthropicModel,
  browserUseModel,
  visionJudgeModel,
  visionJudge = true,
} = {}) {
  const checks = [
    {
      name: "planner-model",
      model: anthropicModel,
      ok: isOpusQualityModel(anthropicModel),
      reason: "Anthropic media planning must use an Opus-tier model.",
    },
    {
      name: "browser-use-model",
      model: browserUseModel,
      ok: isOpusQualityModel(browserUseModel),
      reason: "Browser Use navigation/capture must use an Opus-tier model.",
    },
  ];
  if (visionJudge) {
    checks.push({
      name: "vision-judge-model",
      model: visionJudgeModel,
      ok: isOpenAIQualityVisionModel(visionJudgeModel),
      reason: "Raw and branded media vision review must use a current OpenAI vision-capable GPT model.",
    });
  }
  const concerns = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.reason} Current ${check.name}: ${check.model || "unset"}.`);
  return {
    ok: concerns.length === 0,
    status: concerns.length === 0 ? "accepted" : "blocked",
    checks,
    concerns,
  };
}

export async function discoverCaptureApiBaseUrlFromFrontend({ baseUrl, fetchImpl = fetch } = {}) {
  const appOrigin = normalizeOrigin(baseUrl);
  if (!appOrigin) return "";
  const html = await fetchText(appOrigin, fetchImpl);
  const linkedScripts = extractLinkedScriptPaths(html);
  const scriptOrigins = [];

  for (const scriptPath of linkedScripts) {
    const scriptUrl = new URL(scriptPath, appOrigin).toString();
    const scriptBody = await fetchText(scriptUrl, fetchImpl);
    scriptOrigins.push(...extractHttpOrigins(scriptBody));
  }

  const candidateOrigins = uniqueOrigins([
    ...extractHttpOrigins(html),
    ...scriptOrigins,
  ]).filter((origin) => origin !== appOrigin);

  for (const origin of candidateOrigins) {
    if (await looksLikeAuraApiOrigin(origin, fetchImpl)) {
      return origin;
    }
  }

  return "";
}

export async function resolveCaptureApiBaseUrl({
  baseUrl,
  apiBaseUrl = "",
  fetchImpl = fetch,
} = {}) {
  const explicit = normalizeOrigin(apiBaseUrl);
  if (explicit) return explicit;

  const envApiUrl = normalizeOrigin(
    process.env.AURA_DEMO_SCREENSHOT_API_URL
      || process.env.AURA_CAPTURE_API_BASE_URL
      || process.env.VITE_API_URL
      || "",
  );
  if (envApiUrl) return envApiUrl;

  const discovered = await discoverCaptureApiBaseUrlFromFrontend({ baseUrl, fetchImpl });
  if (discovered) return discovered;

  return normalizeOrigin(baseUrl);
}

function resolveInputPath(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) return null;
  const cwdPath = path.resolve(raw);
  if (fs.existsSync(cwdPath)) return cwdPath;
  const repoPath = resolveDemoRepoPath(raw);
  if (fs.existsSync(repoPath)) return repoPath;
  return cwdPath;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeName(value) {
  return String(value || "candidate")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "candidate";
}

function unique(values, limit = 160) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  )].slice(0, limit);
}

function deriveChangedFilesFromChangelog(changelog) {
  return unique((Array.isArray(changelog?.rawCommits) ? changelog.rawCommits : [])
    .flatMap((commit) => commit?.files || []));
}

function deriveCommitLogFromChangelog(changelog) {
  return (Array.isArray(changelog?.rawCommits) ? changelog.rawCommits : [])
    .map((commit) => {
      const sha = String(commit?.sha || "").slice(0, 12);
      const subject = String(commit?.subject || commit?.cleanSubject || "").trim();
      const files = Array.isArray(commit?.files) && commit.files.length > 0
        ? ` files=${commit.files.slice(0, 8).join(",")}`
        : "";
      return [sha, subject].filter(Boolean).join(" ").concat(files);
    })
    .filter(Boolean)
    .join("\n");
}

function buildBlockedBrandingDecision({ captureAccepted, screenshot }) {
  if (!captureAccepted) {
    return {
      status: "blocked",
      reason: "Branding is blocked until a relevant, publishable Browser Use screenshot passes proof gates.",
    };
  }
  return {
    status: "ready-but-not-run",
    reason: "Screenshot passed proof gates, but the branding step was not invoked.",
    inputPath: screenshot?.path || null,
  };
}

function publicMediaCaption(candidate) {
  const raw = String(candidate?.publicCaption || candidate?.summary || candidate?.reason || "").trim();
  const cleaned = raw
    .replace(/\b(?:capture|open|show|screenshot|proof|browser use)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  if (cleaned.length >= 28) {
    return cleaned;
  }
  return "A focused product update in Aura, shown directly in the desktop experience.";
}

export function buildPublishableMediaManifest({ captureResults = [] } = {}) {
  const assets = [];
  for (const entry of Array.isArray(captureResults) ? captureResults : []) {
    const asset = entry?.branding?.asset;
    const preview = asset?.preview;
    const candidate = entry?.candidate || {};
    if (!entry?.publishReady) continue;
    if (entry.status !== "accepted" || entry.captureAccepted !== true) continue;
    if (entry.qualityGate?.ok !== true || entry.visionGate?.ok !== true) continue;
    if (entry.visionGate?.status !== "accepted") continue;
    if (entry.branding?.status !== "created" || entry.branding?.quality?.ok !== true) continue;
    if (entry.brandedVisionGate?.ok !== true || entry.brandedVisionGate?.status !== "accepted") continue;
    if (!preview?.path || preview.format !== "png" || !fs.existsSync(preview.path)) continue;

    assets.push({
      entryId: candidate.entryId || null,
      title: candidate.title || null,
      publicCaption: publicMediaCaption(candidate),
      source: {
        provider: entry.provider || "browser-use-cloud",
        rawScreenshotPath: entry.result?.screenshot?.path || null,
        brandedSvgPath: asset.format === "svg" ? asset.path : null,
        brandedPngPath: preview.path,
        generatedPngPath: asset.generation?.provider === "openai" ? preview.path : null,
      },
      dimensions: preview.dimensions || null,
      bytes: preview.bytes || null,
      gates: {
        rawQuality: entry.qualityGate.status,
        rawVision: entry.visionGate.status,
        brandedQuality: entry.branding.quality.status,
        brandedVision: entry.brandedVisionGate.status,
      },
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    assets,
    recoveryPolicy: {
      publishOnlyListedAssets: true,
      failedOrMissingMediaBehavior: "omit-media-entirely",
      placeholderHtmlAllowed: false,
      pendingMediaMetadataAllowed: false,
    },
  };
}

async function createBrandingArtifact({
  candidate,
  screenshot,
  outputDir,
  apiKey,
  imageModel = "gpt-image-2",
  imageQuality = "high",
  imageSize = "2560x1440",
  rawVisionGate = null,
  productionImageImpl = createOpenAIProductionMediaImage,
}) {
  if (!screenshot?.path) {
    return {
      status: "blocked",
      reason: "No accepted screenshot is available for branding.",
    };
  }
  if (!apiKey) {
    return {
      status: "blocked",
      reason: "OPENAI_API_KEY is required for production-grade changelog media redraws.",
      quality: {
        ok: false,
        status: "blocked",
        concerns: ["OpenAI image generation is required; legacy screenshot wrappers are not publishable."],
      },
    };
  }
  try {
    const generated = await productionImageImpl({
      apiKey,
      model: imageModel,
      inputImagePath: screenshot.path,
      outputPath: path.join(outputDir, "openai-production-media.png"),
      candidate,
      rawVisionGate,
      quality: imageQuality,
      size: imageSize,
    });
    if (generated.status !== "created") {
      return {
        ...generated,
        quality: {
          ok: false,
          status: generated.status || "failed",
          concerns: [generated.reason || "OpenAI production image generation failed."],
        },
      };
    }
    const quality = assessBrandedMediaAsset(generated.asset);
    return {
      status: quality.ok ? "created" : "rejected",
      reason: quality.ok
        ? "Created a production-grade OpenAI redraw from the raw product proof screenshot."
        : "OpenAI production image failed structural quality checks.",
      asset: generated.asset,
      generation: generated.asset.generation,
      quality,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isShellOrLayoutProofCandidate(candidate = null) {
  const seedPlan = candidate?.seedPlan || {};
  const haystack = [
    candidate?.title,
    candidate?.reason,
    candidate?.proofGoal,
    candidate?.publicCaption,
    ...(Array.isArray(seedPlan.capabilities) ? seedPlan.capabilities : []),
    ...(Array.isArray(seedPlan.requiredState) ? seedPlan.requiredState : []),
    ...(Array.isArray(seedPlan.proofBoundary) ? seedPlan.proofBoundary : []),
    ...(Array.isArray(seedPlan.contextBoundary) ? seedPlan.contextBoundary : []),
    ...(Array.isArray(seedPlan.readinessSignals) ? seedPlan.readinessSignals : []),
    seedPlan.notes,
  ].filter(Boolean).join("\n").toLowerCase();
  return /\b(?:desktop shell|shell chrome|bottom taskbar|taskbar|floating[- ]glass|inset main panel|sidebar|sidekick|transparent gap|panel separation|rounded capsule|layout)\b/.test(haystack);
}

function rawVisionHasRealDesktopProof(visionGate) {
  const visibleProof = Array.isArray(visionGate?.judgment?.visibleProof)
    ? visionGate.judgment.visibleProof.join("\n").toLowerCase()
    : "";
  return /\b(?:aura|desktop|shell|taskbar|sidebar|sidekick|panel|topbar|header|navigation|gallery|app)\b/.test(visibleProof);
}

function rawVisionRepairText(judgment) {
  return [
    ...(Array.isArray(judgment?.reasons) ? judgment.reasons : []),
    ...(Array.isArray(judgment?.visibleProof) ? judgment.visibleProof : []),
  ].filter(Boolean).join("\n").toLowerCase();
}

function rawVisionHasSemanticProofFailure(judgment) {
  const text = rawVisionRepairText(judgment);
  return /\b(?:does not|doesn't|cannot|can't|could not|not)\s+(?:clearly\s+)?(?:prove|verify|show|demonstrate|confirm|support|establish)\b/.test(text)
    || /\b(?:not convincingly|insufficient proof|missing proof|wrong feature|wrong area|unrelated|different feature|invented|hallucinated|not visible|no visible evidence|empty|placeholder)\b/.test(text);
}

function rawVisionHasQualityRepairSignal(judgment) {
  const text = rawVisionRepairText(judgment);
  return /\b(?:soft|compressed|pixelated|low[- ]resolution|blurred|blurry|fuzzy|smeared|tiny|too small|distant|zoom|obscured|clipped|cropped|contrast|readability|legibility|readable|legible|subtle)\b/.test(text);
}

export function rawVisionCanBeRepairedByImageGeneration(visionGate, candidate = null) {
  if (visionGate?.ok === true) return visionGate.status === "accepted";
  const judgment = visionGate?.judgment;
  if (!judgment) return false;
  const hasVisibleProof = Array.isArray(judgment.visibleProof) && judgment.visibleProof.length > 0;
  if (!hasVisibleProof || rawVisionHasSemanticProofFailure(judgment)) return false;

  const directlyRepairableCategories = new Set(["unreadable", "clipped"]);
  const ambiguousRepairableCategories = new Set(["other", null]);
  const shellLayoutNeedsClarification = judgment.rejectionCategory === "wrong-screen"
    && isShellOrLayoutProofCandidate(candidate)
    && rawVisionHasRealDesktopProof(visionGate);
  if (shellLayoutNeedsClarification) return true;
  const category = judgment.rejectionCategory ?? null;
  if (directlyRepairableCategories.has(category)) return true;
  return ambiguousRepairableCategories.has(category) && rawVisionHasQualityRepairSignal(judgment);
}

function brandedAssetPreservesAcceptedRawProof(branding) {
  const asset = branding?.asset;
  const screenshotFrame = asset?.layout?.screenshot;
  const embedded = asset?.embeddedScreenshot;
  if (branding?.status !== "created" || branding?.quality?.ok !== true) return false;
  if (!asset?.dimensions || !screenshotFrame || !embedded) return false;
  if (asset.generation?.provider) return false;
  return (
    asset.layout?.titleLines === 0
    && asset.layout?.subtitleLines === 0
    && screenshotFrame.x === 0
    && screenshotFrame.y === 0
    && screenshotFrame.width === asset.dimensions.width
    && screenshotFrame.height === asset.dimensions.height
    && embedded.scale === 1
    && embedded.width === embedded.renderedWidth
    && embedded.height === embedded.renderedHeight
    && asset.preview?.dimensions?.width === asset.dimensions.width
    && asset.preview?.dimensions?.height === asset.dimensions.height
  );
}

function reuseRawVisionGateForPreservedBranding({ visionGate, branding }) {
  if (visionGate?.ok !== true || visionGate?.status !== "accepted") return null;
  if (!brandedAssetPreservesAcceptedRawProof(branding)) return null;
  return {
    ok: true,
    status: "accepted",
    concerns: [],
    judgment: {
      pass: true,
      score: visionGate.judgment?.score ?? null,
      reasons: [
        "Raw vision proof was accepted, and the branded asset preserves the same product screenshot at native scale with no header, crop, or resize.",
        ...(Array.isArray(visionGate.judgment?.reasons) ? visionGate.judgment.reasons : []),
      ],
      visibleProof: Array.isArray(visionGate.judgment?.visibleProof)
        ? visionGate.judgment.visibleProof
        : [],
      rejectionCategory: null,
    },
  };
}

function buildLocalCaptureSession(captureSecret) {
  const tokenHash = createHash("sha256")
    .update(String(captureSecret || ""))
    .digest("hex")
    .slice(0, 32);
  const generatedAt = new Date().toISOString();
  return {
    user_id: "capture-demo-user",
    display_name: "Aura Capture",
    profile_image: "",
    primary_zid: "0://aura-capture",
    zero_wallet: "0x0000000000000000000000000000000000000000",
    wallets: [],
    is_zero_pro: true,
    is_access_granted: true,
    access_token: `aura-capture:${tokenHash}`,
    created_at: generatedAt,
    validated_at: generatedAt,
  };
}

export async function requestCaptureSession({ baseUrl, apiBaseUrl = "", captureSecret, fetchImpl = fetch } = {}) {
  const concerns = [];
  if (!baseUrl) {
    return {
      ok: false,
      concerns: ["Base URL is missing."],
    };
  }
  if (!captureSecret) {
    return {
      ok: false,
      concerns: ["Capture secret is missing."],
    };
  }
  if (String(captureSecret).length < 32) {
    return {
      ok: false,
      concerns: ["Capture secret must be at least 32 characters for local media sessions."],
    };
  }

  const sessionBaseUrl = apiBaseUrl || baseUrl;
  const sessionResponse = await fetchImpl(new URL("/api/capture/session", sessionBaseUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: captureSecret }),
  }).catch((error) => ({ error }));
  if (sessionResponse.error) {
    concerns.push(`Capture session endpoint unavailable: ${sessionResponse.error.message || sessionResponse.error}`);
  } else {
    const contentType = sessionResponse.headers?.get?.("content-type") || "";
    const text = await sessionResponse.text();
    let body = null;
    if (contentType.includes("json") && text) {
      try {
        body = JSON.parse(text);
      } catch {
        concerns.push("Capture session route returned invalid JSON.");
      }
    }
    if (sessionResponse.status !== 201) {
      concerns.push(`Capture session route returned HTTP ${sessionResponse.status}; expected 201.`);
    }
    if (!body?.access_token || !String(body.access_token).startsWith("aura-capture:")) {
      concerns.push("Capture session route did not return an aura-capture access token.");
    }
    if (concerns.length > 0) {
      return {
        ok: true,
        sessionStatus: sessionResponse.status || null,
        concerns: [],
        fallbackConcerns: concerns,
        session: buildLocalCaptureSession(captureSecret),
        source: "local-media-session",
      };
    }
    return {
      ok: concerns.length === 0,
      sessionStatus: sessionResponse.status || null,
      concerns,
      session: concerns.length === 0 ? body : null,
      source: "api",
    };
  }

  return {
    ok: true,
    sessionStatus: null,
    concerns: [],
    fallbackConcerns: concerns,
    session: buildLocalCaptureSession(captureSecret),
    source: "local-media-session",
  };
}

export async function preflightCaptureAuth({ baseUrl, apiBaseUrl = "", captureSecret, fetchImpl = fetch } = {}) {
  const concerns = [];
  if (!baseUrl) {
    return {
      ok: false,
      concerns: ["Base URL is missing."],
    };
  }

  const loginUrl = buildCaptureLoginUrl(baseUrl, "/desktop", apiBaseUrl);
  const loginResponse = await fetchImpl(loginUrl.toString(), {
    method: "GET",
    redirect: "manual",
  }).catch((error) => ({ error }));
  if (loginResponse.error) {
    concerns.push(`Capture login preflight failed: ${loginResponse.error.message || loginResponse.error}`);
  } else if (loginResponse.status < 200 || loginResponse.status >= 400) {
    concerns.push(`Capture login route returned HTTP ${loginResponse.status}; expected a successful SPA route.`);
  }

  const sessionResult = await requestCaptureSession({
    baseUrl,
    apiBaseUrl,
    captureSecret,
    fetchImpl,
  });
  if (!sessionResult.ok) {
    concerns.push(...sessionResult.concerns);
  }

  return {
    ok: concerns.length === 0,
    loginStatus: loginResponse.status || null,
    sessionStatus: sessionResult.sessionStatus || null,
    concerns,
    sessionAvailable: Boolean(sessionResult.session?.access_token),
  };
}

export async function runChangelogMediaEvaluation({
  changelogFile,
  outputDir,
  baseUrl,
  apiBaseUrl = "",
  maxCandidates = 3,
  runBrowserUse = true,
  requireCaptureSecret = true,
  anthropicModel = "claude-opus-4-7",
  browserUseModel = DEFAULT_BROWSER_USE_MODEL,
  browserUseTimeoutMs = DEFAULT_BROWSER_USE_TIMEOUT_MS,
  browserUseIntervalMs = DEFAULT_BROWSER_USE_INTERVAL_MS,
  entryChunkSize = 20,
  plannerTimeoutMs = 120_000,
  maxCostUsd = "",
  enableRecording = false,
  strictCapture = false,
  visionJudge = true,
  visionJudgeModel = "gpt-5.2",
  openAIImageModel = "gpt-image-2",
  openAIImageQuality = "high",
  openAIImageSize = "2560x1440",
  preflightCaptureAuthImpl = preflightCaptureAuth,
  requestCaptureSessionImpl = requestCaptureSession,
  runBrowserUseTaskImpl = runBrowserUseTask,
  runHighResolutionCaptureImpl = captureHighResolutionAuraProof,
  visionJudgeImpl = null,
  productionImageImpl = createOpenAIProductionMediaImage,
  resolveCaptureApiBaseUrlImpl = resolveCaptureApiBaseUrl,
  onProgress = null,
} = {}) {
  const resolvedChangelogFile = resolveInputPath(changelogFile);
  if (!resolvedChangelogFile) {
    throw new Error("Pass --changelog-file with a generated changelog JSON file.");
  }
  const changelog = JSON.parse(fs.readFileSync(resolvedChangelogFile, "utf8"));
  const sitemap = await buildAuraNavigationSitemap();
  const learnedKnowledge = loadChangelogMediaKnowledge();
  const allChangelogEntries = extractChangelogMediaEntries(changelog);
  const refreshExistingMedia = isEnabled(process.env.CHANGELOG_MEDIA_REFRESH_EXISTING);
  const changelogEntries = refreshExistingMedia
    ? allChangelogEntries
    : allChangelogEntries.filter((entry) => !entry.mediaPublished);
  const existingPublishedMediaCount = allChangelogEntries.length - changelogEntries.length;
  const changedFiles = deriveChangedFilesFromChangelog(changelog);
  const commitLog = deriveCommitLogFromChangelog(changelog);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for media plan evaluation.");
  }
  const visionApiKey = String(process.env.OPENAI_API_KEY || process.env.AURA_CHANGELOG_MEDIA_OPENAI_API_KEY || "").trim();
  const resolvedVisionJudgeImpl = visionJudgeImpl || judgeChangelogMediaWithOpenAI;
  const modelQualityGate = assessMediaModelQuality({
    anthropicModel,
    browserUseModel,
    visionJudgeModel,
    visionJudge,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "aura-navigation-sitemap.json"), sitemap);
  writeJson(path.join(outputDir, "changelog-media-knowledge.json"), learnedKnowledge);

  const planning = changelogEntries.length > 0
    ? await planChangelogMediaWithAnthropic({
      apiKey,
      model: anthropicModel,
      changelogEntries,
      sitemap,
      learnedKnowledge,
      commitLog,
      changedFiles,
      maxCandidates,
      entryChunkSize,
      timeoutMs: plannerTimeoutMs,
      onProgress,
    })
    : {
      rawPlan: { schemaVersion: 1, generatedAt: new Date().toISOString(), candidates: [], skipped: [] },
      plan: { schemaVersion: 1, generatedAt: new Date().toISOString(), candidates: [], skipped: [] },
      forcedSkipped: [],
      coverage: { ok: true, expectedCount: 0, classifiedCount: 0, missing: [], duplicate: [], unknown: [] },
      attempts: [],
      prompt: "All changelog entries already have published media; no media planning was needed.",
    };
  writeJson(path.join(outputDir, "media-plan.raw.json"), planning.rawPlan);
  writeJson(path.join(outputDir, "media-plan.json"), planning.plan);
  writeJson(path.join(outputDir, "media-plan-forced-skips.json"), planning.forcedSkipped || []);
  writeJson(path.join(outputDir, "media-plan-coverage.json"), planning.coverage);
  writeJson(path.join(outputDir, "media-plan-attempts.json"), planning.attempts.map((attempt) => ({
    attempt: attempt.attempt,
    coverage: attempt.coverage,
  })));
  fs.writeFileSync(path.join(outputDir, "anthropic-media-planner-prompt.md"), `${planning.prompt}\n`, "utf8");

  const browserUseKeyAvailable = Boolean(process.env.BROWSER_USE_API_KEY?.trim());
  const resolvedApiBaseUrl = baseUrl
    ? await resolveCaptureApiBaseUrlImpl({ baseUrl, apiBaseUrl })
    : normalizeOrigin(apiBaseUrl);
  const captureSecret = String(
    process.env.AURA_CHANGELOG_CAPTURE_SECRET
      || process.env.AURA_CAPTURE_MODE_SECRET
      || "",
  ).trim();
  const captureAuthAvailable = Boolean(captureSecret);
  const capturePreflight = runBrowserUse && browserUseKeyAvailable && baseUrl && captureAuthAvailable
    ? await preflightCaptureAuthImpl({ baseUrl, apiBaseUrl: resolvedApiBaseUrl, captureSecret })
    : null;
  const captureResults = [];

  for (const [index, candidate] of planning.plan.candidates.entries()) {
    const candidateDir = path.join(outputDir, `candidate-${index + 1}-${safeName(candidate.entryId || candidate.title)}`);
    fs.mkdirSync(candidateDir, { recursive: true });
    const story = candidate.proofGoal || candidate.title;
    const seedPlan = normalizeCaptureSeedPlan(candidate.seedPlan, candidate);
    writeJson(path.join(candidateDir, "capture-seed-plan.json"), seedPlan);
    const contract = await buildAuraNavigationContract({
      prompt: story,
      changedFiles: candidate.changedFiles,
      commitLog,
    });
    contract.captureSeedPlan = seedPlan;
    writeJson(path.join(candidateDir, "navigation-contract.json"), contract);

    const blockers = [];
    if (!runBrowserUse) blockers.push("Browser Use execution disabled by --plan-only.");
    if (!browserUseKeyAvailable) blockers.push("BROWSER_USE_API_KEY is not available.");
    if (visionJudge && !visionApiKey) blockers.push("OPENAI_API_KEY is not available for media vision review.");
    if (runBrowserUse && !modelQualityGate.ok) {
      blockers.push(...modelQualityGate.concerns);
    }
    if (!baseUrl) blockers.push("Base URL is missing; pass --base-url or set AURA_DEMO_SCREENSHOT_BASE_URL.");
    if (requireCaptureSecret && !captureAuthAvailable) {
      blockers.push("Capture secret is missing; set AURA_CHANGELOG_CAPTURE_SECRET or AURA_CAPTURE_MODE_SECRET.");
    }
    if (capturePreflight && !capturePreflight.ok) {
      blockers.push(...capturePreflight.concerns.map((concern) => `Capture auth preflight failed: ${concern}`));
    }

    if (blockers.length > 0) {
      const skipped = {
        candidate,
        status: "blocked",
        blockers,
        capturePreflight,
        captureAccepted: false,
        publishReady: false,
        qualityGate: {
          ok: false,
          status: "blocked",
          concerns: blockers,
        },
        branding: buildBlockedBrandingDecision({
          captureAccepted: false,
          screenshot: null,
        }),
      };
      writeJson(path.join(candidateDir, "capture-summary.json"), skipped);
      captureResults.push(skipped);
      continue;
    }

    const captureSessionResult = captureAuthAvailable && blockers.length === 0
      ? await requestCaptureSessionImpl({ baseUrl, apiBaseUrl: resolvedApiBaseUrl, captureSecret })
      : null;
    if (captureSessionResult && !captureSessionResult.ok) {
      blockers.push(...captureSessionResult.concerns.map((concern) => `Capture session mint failed: ${concern}`));
    }
    if (blockers.length > 0) {
      const skipped = {
        candidate,
        status: "blocked",
        blockers,
        capturePreflight,
        captureAccepted: false,
        publishReady: false,
        qualityGate: {
          ok: false,
          status: "blocked",
          concerns: blockers,
        },
        branding: buildBlockedBrandingDecision({
          captureAccepted: false,
          screenshot: null,
        }),
      };
      writeJson(path.join(candidateDir, "capture-summary.json"), skipped);
      captureResults.push(skipped);
      continue;
    }

    const captureAuth = captureAuthAvailable
      ? {
        enabled: true,
        loginUrl: buildCaptureLoginUrl(
          baseUrl,
          candidate.targetPath || contract.likelyApps?.[0]?.path || "/desktop",
          resolvedApiBaseUrl,
          captureSessionResult?.session || null,
        ),
        autoSession: Boolean(captureSessionResult?.session),
      }
      : { enabled: false, loginUrl: null };
    const task = buildBrowserUseTask({
      baseUrl,
      story,
      contract,
      captureAuth,
    });
    fs.writeFileSync(path.join(candidateDir, "browser-use-task.md"), `${redactCaptureLoginSecrets(task)}\n`, "utf8");

    const result = await runBrowserUseTaskImpl({
      task,
      model: browserUseModel,
      outputDir: candidateDir,
      profileId: "",
      enableRecording,
      desktopViewport: contract.desktopCapturePolicy.viewport,
      maxCostUsd,
      useOutputSchema: true,
      sensitiveData: captureAuth.enabled ? { captureSecret } : null,
      timeoutMs: browserUseTimeoutMs,
      intervalMs: browserUseIntervalMs,
    });
    const highResolutionCapture = runHighResolutionCaptureImpl && captureSessionResult?.session
      ? await runHighResolutionCaptureImpl({
        baseUrl,
        apiBaseUrl: resolvedApiBaseUrl,
        captureSession: captureSessionResult.session,
        targetPath: candidate.targetPath || contract.likelyApps?.[0]?.path || "/desktop",
        targetAppId: candidate.targetAppId || contract.likelyApps?.[0]?.id || null,
        outputPath: path.join(candidateDir, "high-resolution-proof.png"),
        viewport: contract.desktopCapturePolicy.viewport,
        story: [candidate.title, candidate.proofGoal, candidate.publicCaption].filter(Boolean).join("\n"),
        seedPlan,
      })
      : null;
    if (highResolutionCapture) {
      writeJson(path.join(candidateDir, "high-resolution-capture.json"), highResolutionCapture);
    }
    const proofResult = highResolutionCapture?.ok && highResolutionCapture?.screenshot
      ? {
        ...result,
        provider: highResolutionCapture.provider,
        output: highResolutionCapture.output,
        screenshot: highResolutionCapture.screenshot,
        highResolutionCapture,
        browserUseResult: result,
      }
      : {
        ...result,
        highResolutionCapture,
      };
    const desktopEvaluation = evaluateDesktopCapture({
      output: proofResult.output,
      screenshot: proofResult.screenshot,
      mediaEligibility: contract.mediaEligibility,
      minDesktopViewport: contract.desktopCapturePolicy.minimumViewport,
    });
    const qualityGate = assessChangelogMediaQuality({
      desktopEvaluation,
      output: proofResult.output,
      screenshot: proofResult.screenshot,
      candidate,
      stage: "raw",
    });
    const visionGate = qualityGate.ok && visionJudge
      ? await resolvedVisionJudgeImpl({
        apiKey: visionApiKey,
        model: visionJudgeModel,
        imagePath: proofResult.screenshot?.path,
        candidate,
        stage: "raw",
      })
      : {
        ok: qualityGate.ok,
        status: visionJudge ? "blocked" : "skipped",
        concerns: qualityGate.ok ? [] : ["Vision judge skipped because deterministic quality failed."],
        judgment: null,
      };
    const rawVisionAccepted = visionGate.ok === true && visionGate.status === "accepted";
    const rawVisionRepairable = rawVisionCanBeRepairedByImageGeneration(visionGate, candidate);
    const sourceAcceptedForProductionImage = Boolean(qualityGate.ok && (rawVisionAccepted || rawVisionRepairable));
    const branding = sourceAcceptedForProductionImage
      ? await createBrandingArtifact({
        candidate,
        screenshot: proofResult.screenshot,
        outputDir: candidateDir,
        apiKey: visionApiKey,
        imageModel: openAIImageModel,
        imageQuality: openAIImageQuality,
        imageSize: openAIImageSize,
        rawVisionGate: visionGate,
        productionImageImpl,
      })
      : buildBlockedBrandingDecision({
        captureAccepted: false,
        screenshot: proofResult.screenshot,
      });
    const preservedBrandingVisionGate = reuseRawVisionGateForPreservedBranding({
      visionGate,
      branding,
    });
    const brandedVisionGate = preservedBrandingVisionGate
      || (branding.status === "created" && branding.asset?.path && visionJudge
        ? await resolvedVisionJudgeImpl({
          apiKey: visionApiKey,
          model: visionJudgeModel,
          imagePath: branding.asset.preview?.path || branding.asset.path,
          referenceImagePath: branding.asset?.generation?.provider === "openai"
            ? proofResult.screenshot?.path
            : null,
          candidate,
          stage: "branded",
        })
        : {
          ok: false,
          status: branding.status === "created" ? "skipped" : "blocked",
          concerns: branding.status === "created" && !visionJudge
            ? ["Branded vision judge is required for publishable media."]
            : ["Branded vision judge skipped because no accepted branded asset was created."],
          judgment: null,
        });
    const brandedVisionAccepted = brandedVisionGate.ok === true && brandedVisionGate.status === "accepted";
    const captureAccepted = Boolean(sourceAcceptedForProductionImage && brandedVisionAccepted);
    const publishReady = Boolean(sourceAcceptedForProductionImage && branding.status === "created" && branding.quality?.ok && brandedVisionAccepted);
    const summary = {
      candidate,
      status: captureAccepted ? "accepted" : "rejected",
      provider: proofResult.provider || "browser-use-cloud",
      model: browserUseModel,
      captureAccepted,
      publishReady,
      result: proofResult,
      browserUseResult: result,
      highResolutionCapture,
      seedPlan,
      desktopEvaluation,
      qualityGate,
      visionGate,
      rawVisionRepairable,
      branding,
      brandedVisionGate,
    };
    writeJson(path.join(candidateDir, "capture-summary.json"), summary);
    captureResults.push(summary);
    if (strictCapture && !captureAccepted) {
      break;
    }
  }

  const publishableMedia = buildPublishableMediaManifest({ captureResults });
  writeJson(path.join(outputDir, "publishable-media-manifest.json"), publishableMedia);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    changelogFile: resolvedChangelogFile,
    baseUrl: baseUrl || null,
    apiBaseUrl: resolvedApiBaseUrl || null,
    models: {
      anthropic: anthropicModel,
      browserUse: browserUseModel,
      visionProvider: "openai",
      visionJudge: visionJudgeModel,
      imageGeneration: openAIImageModel,
    },
    modelQualityGate,
    browserUseRunOptions: {
      timeoutMs: browserUseTimeoutMs,
      intervalMs: browserUseIntervalMs,
      maxCostUsd: maxCostUsd || null,
      plannerTimeoutMs,
      entryChunkSize,
    },
    env: {
      anthropicAvailable: true,
      openAiAvailable: Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.AURA_CHANGELOG_MEDIA_OPENAI_API_KEY?.trim()),
      browserUseAvailable: browserUseKeyAvailable,
      captureAuthAvailable,
    },
    capturePreflight,
    existingPublishedMediaCount,
    counts: {
      changelogEntries: changelogEntries.length,
      existingPublishedMedia: existingPublishedMediaCount,
      rawCommits: Array.isArray(changelog?.rawCommits) ? changelog.rawCommits.length : 0,
      changedFiles: changedFiles.length,
      plannedCandidates: planning.plan.candidates.length,
      skippedByPlanner: planning.plan.skipped.length,
      plannerMissingEntries: planning.coverage.missing.length,
      plannerDuplicateEntries: planning.coverage.duplicate.length,
      plannerUnknownEntries: planning.coverage.unknown.length,
      plannerForcedSkips: planning.forcedSkipped?.length || 0,
      captureAccepted: captureResults.filter((entry) => entry.captureAccepted).length,
      captureRejected: captureResults.filter((entry) => entry.status === "rejected").length,
      captureBlocked: captureResults.filter((entry) => entry.status === "blocked").length,
      visionAccepted: captureResults.filter((entry) => entry.visionGate?.ok).length,
      visionRejected: captureResults.filter((entry) => entry.visionGate?.status === "rejected").length,
      brandingCreated: captureResults.filter((entry) => entry.branding?.status === "created").length,
      brandingReadyButNotRun: captureResults.filter((entry) => entry.branding?.status === "ready-but-not-run").length,
      brandedVisionAccepted: captureResults.filter((entry) => entry.brandedVisionGate?.ok).length,
      brandedVisionRejected: captureResults.filter((entry) => entry.brandedVisionGate?.status === "rejected").length,
      publishReady: captureResults.filter((entry) => entry.publishReady).length,
      publishableMediaAssets: publishableMedia.assets.length,
    },
    publishableMedia,
    selectionCoverage: planning.coverage,
    plannerAttemptCount: planning.attempts.length,
    mediaPlan: planning.plan,
    captureResults: captureResults.map((entry) => ({
      entryId: entry.candidate?.entryId || null,
      title: entry.candidate?.title || null,
      status: entry.status,
      captureAccepted: entry.captureAccepted,
      publishReady: Boolean(entry.publishReady),
      blockers: entry.blockers || [],
      concerns: [
        ...(entry.qualityGate?.concerns || entry.desktopEvaluation?.concerns || []),
        ...(entry.visionGate?.concerns || []),
      ],
      screenshot: entry.result?.screenshot || null,
      qualityGate: entry.qualityGate || null,
      visionGate: entry.visionGate || null,
      branding: entry.branding || null,
      brandedVisionGate: entry.brandedVisionGate || null,
    })),
  };
  writeJson(path.join(outputDir, "evaluation-report.json"), report);
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  const args = parseArgs(argv);
  const outputDir = path.resolve(args["output-dir"] || path.join(process.cwd(), "output", "changelog-media-evaluation"));
  const report = await runChangelogMediaEvaluation({
    changelogFile: args["changelog-file"],
    outputDir,
    baseUrl: String(args["base-url"] || process.env.AURA_DEMO_SCREENSHOT_BASE_URL || "").trim(),
    apiBaseUrl: String(
      args["api-base-url"]
        || process.env.AURA_DEMO_SCREENSHOT_API_URL
        || process.env.AURA_CAPTURE_API_BASE_URL
        || "",
    ).trim(),
    maxCandidates: Number.parseInt(String(args["max-candidates"] || "3"), 10) || 3,
    runBrowserUse: !isEnabled(args["plan-only"]),
    requireCaptureSecret: !isEnabled(args["allow-unauthenticated"]),
    anthropicModel: String(args["anthropic-model"] || process.env.CHANGELOG_MEDIA_ANTHROPIC_MODEL || "claude-opus-4-7").trim(),
    browserUseModel: String(args["browser-use-model"] || process.env.BROWSER_USE_MODEL || DEFAULT_BROWSER_USE_MODEL).trim(),
    browserUseTimeoutMs: parsePositiveInteger(
      args["browser-use-timeout-ms"] || process.env.BROWSER_USE_TIMEOUT_MS,
      DEFAULT_BROWSER_USE_TIMEOUT_MS,
    ),
    browserUseIntervalMs: parsePositiveInteger(
      args["browser-use-interval-ms"] || process.env.BROWSER_USE_INTERVAL_MS,
      DEFAULT_BROWSER_USE_INTERVAL_MS,
    ),
    maxCostUsd: args["max-cost-usd"] || process.env.BROWSER_USE_MAX_COST_USD || "",
    entryChunkSize: parsePositiveInteger(
      args["entry-chunk-size"] || process.env.CHANGELOG_MEDIA_ENTRY_CHUNK_SIZE,
      20,
    ),
    plannerTimeoutMs: parsePositiveInteger(
      args["planner-timeout-ms"] || process.env.CHANGELOG_MEDIA_PLANNER_TIMEOUT_MS,
      120_000,
    ),
    enableRecording: isEnabled(args["enable-recording"] || process.env.BROWSER_USE_ENABLE_RECORDING),
    strictCapture: isEnabled(args.strict),
    visionJudge: !isDisabled(args["vision-judge"] ?? process.env.CHANGELOG_MEDIA_VISION_JUDGE ?? "true"),
    visionJudgeModel: String(args["vision-judge-model"] || process.env.CHANGELOG_MEDIA_OPENAI_VISION_MODEL || "gpt-5.2").trim(),
    openAIImageModel: String(args["openai-image-model"] || process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_MODEL || "gpt-image-2").trim(),
    openAIImageQuality: String(args["openai-image-quality"] || process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_QUALITY || "high").trim(),
    openAIImageSize: String(args["openai-image-size"] || process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_SIZE || "2560x1440").trim(),
    onProgress: (event) => {
      const label = [
        "[changelog-media]",
        event.stage,
        event.chunkLabel ? `chunk=${event.chunkLabel}` : "",
        event.attempt ? `attempt=${event.attempt}` : "",
        event.entryCount != null ? `entries=${event.entryCount}` : "",
        event.candidateCount != null ? `candidates=${event.candidateCount}` : "",
        event.skippedCount != null ? `skipped=${event.skippedCount}` : "",
      ].filter(Boolean).join(" ");
      process.stderr.write(`${label}\n`);
    },
  });
  console.log(JSON.stringify({
    ok: true,
    outputDir,
    baseUrl: report.baseUrl,
    apiBaseUrl: report.apiBaseUrl,
    counts: report.counts,
    existingPublishedMediaCount: report.existingPublishedMediaCount,
    env: report.env,
    modelQualityGate: report.modelQualityGate,
    browserUseRunOptions: report.browserUseRunOptions,
    publishableMedia: {
      assetCount: report.publishableMedia.assets.length,
      recoveryPolicy: report.publishableMedia.recoveryPolicy,
    },
    selectionCoverage: report.selectionCoverage,
    plannerAttemptCount: report.plannerAttemptCount,
    candidates: report.mediaPlan.candidates.map((candidate) => ({
      entryId: candidate.entryId,
      title: candidate.title,
      targetAppId: candidate.targetAppId,
      targetPath: candidate.targetPath,
      confidence: candidate.confidence,
    })),
    captureResults: report.captureResults.map((entry) => ({
      entryId: entry.entryId,
      status: entry.status,
      captureAccepted: entry.captureAccepted,
      publishReady: entry.publishReady,
      blockers: entry.blockers,
      concerns: entry.concerns,
      vision: entry.visionGate?.status || null,
      branding: entry.branding?.status || null,
      brandedVision: entry.brandedVisionGate?.status || null,
    })),
  }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
