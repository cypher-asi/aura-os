#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildAuraNavigationContract,
  buildAuraNavigationSitemap,
} from "./lib/aura-navigation-contract.mjs";
import {
  extractChangelogMediaEntries,
  planChangelogMediaWithAnthropic,
} from "./lib/changelog-media-planner.mjs";
import { resolveDemoRepoPath } from "./lib/demo-repo-paths.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  DEFAULT_BROWSER_USE_MODEL,
  buildBrowserUseTask,
  buildCaptureLoginUrl,
  evaluateDesktopCapture,
  runBrowserUseTask,
} from "./changelog-media-browser-use-trial.mjs";

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

function buildBrandingDecision({ captureAccepted, screenshot, openAiAvailable }) {
  if (!captureAccepted) {
    return {
      status: "blocked",
      reason: "Branding is blocked until a relevant, publishable Browser Use screenshot passes proof gates.",
    };
  }
  if (!openAiAvailable) {
    return {
      status: "ready-but-not-run",
      reason: "Screenshot passed proof gates, but OPENAI_API_KEY is not available in this environment.",
      inputPath: screenshot?.path || null,
    };
  }
  return {
    status: "ready",
    reason: "Screenshot passed proof gates and can be handed to the branding step.",
    inputPath: screenshot?.path || null,
  };
}

export async function preflightCaptureAuth({ baseUrl, captureSecret, fetchImpl = fetch } = {}) {
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

  const loginUrl = new URL("/capture-login", baseUrl);
  loginUrl.searchParams.set("returnTo", "/desktop");
  const loginResponse = await fetchImpl(loginUrl.toString(), {
    method: "GET",
    redirect: "manual",
  }).catch((error) => ({ error }));
  if (loginResponse.error) {
    concerns.push(`Capture login preflight failed: ${loginResponse.error.message || loginResponse.error}`);
  } else if (loginResponse.status < 200 || loginResponse.status >= 400) {
    concerns.push(`Capture login route returned HTTP ${loginResponse.status}; expected a successful SPA route.`);
  }

  const sessionResponse = await fetchImpl(new URL("/api/capture/session", baseUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: captureSecret }),
  }).catch((error) => ({ error }));
  if (sessionResponse.error) {
    concerns.push(`Capture session preflight failed: ${sessionResponse.error.message || sessionResponse.error}`);
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
  }

  return {
    ok: concerns.length === 0,
    loginStatus: loginResponse.status || null,
    sessionStatus: sessionResponse.status || null,
    concerns,
  };
}

export async function runChangelogMediaEvaluation({
  changelogFile,
  outputDir,
  baseUrl,
  maxCandidates = 3,
  runBrowserUse = true,
  requireCaptureSecret = true,
  anthropicModel = "claude-opus-4-7",
  browserUseModel = DEFAULT_BROWSER_USE_MODEL,
  maxCostUsd = "",
  enableRecording = false,
  strictCapture = false,
} = {}) {
  const resolvedChangelogFile = resolveInputPath(changelogFile);
  if (!resolvedChangelogFile) {
    throw new Error("Pass --changelog-file with a generated changelog JSON file.");
  }
  const changelog = JSON.parse(fs.readFileSync(resolvedChangelogFile, "utf8"));
  const sitemap = await buildAuraNavigationSitemap();
  const changelogEntries = extractChangelogMediaEntries(changelog);
  const changedFiles = deriveChangedFilesFromChangelog(changelog);
  const commitLog = deriveCommitLogFromChangelog(changelog);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for media plan evaluation.");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "aura-navigation-sitemap.json"), sitemap);

  const planning = await planChangelogMediaWithAnthropic({
    apiKey,
    model: anthropicModel,
    changelogEntries,
    sitemap,
    commitLog,
    changedFiles,
    maxCandidates,
  });
  writeJson(path.join(outputDir, "media-plan.raw.json"), planning.rawPlan);
  writeJson(path.join(outputDir, "media-plan.json"), planning.plan);
  writeJson(path.join(outputDir, "media-plan-coverage.json"), planning.coverage);
  writeJson(path.join(outputDir, "media-plan-attempts.json"), planning.attempts.map((attempt) => ({
    attempt: attempt.attempt,
    coverage: attempt.coverage,
  })));
  fs.writeFileSync(path.join(outputDir, "anthropic-media-planner-prompt.md"), `${planning.prompt}\n`, "utf8");

  const browserUseKeyAvailable = Boolean(process.env.BROWSER_USE_API_KEY?.trim());
  const openAiAvailable = Boolean(process.env.OPENAI_API_KEY?.trim());
  const captureSecret = String(
    process.env.AURA_CHANGELOG_CAPTURE_SECRET
      || process.env.AURA_CAPTURE_MODE_SECRET
      || "",
  ).trim();
  const captureAuthAvailable = Boolean(captureSecret);
  const capturePreflight = runBrowserUse && browserUseKeyAvailable && baseUrl && captureAuthAvailable
    ? await preflightCaptureAuth({ baseUrl, captureSecret })
    : null;
  const captureResults = [];

  for (const [index, candidate] of planning.plan.candidates.entries()) {
    const candidateDir = path.join(outputDir, `candidate-${index + 1}-${safeName(candidate.entryId || candidate.title)}`);
    fs.mkdirSync(candidateDir, { recursive: true });
    const story = candidate.proofGoal || candidate.title;
    const contract = await buildAuraNavigationContract({
      prompt: story,
      changedFiles: candidate.changedFiles,
      commitLog,
    });
    writeJson(path.join(candidateDir, "navigation-contract.json"), contract);

    const blockers = [];
    if (!runBrowserUse) blockers.push("Browser Use execution disabled by --plan-only.");
    if (!browserUseKeyAvailable) blockers.push("BROWSER_USE_API_KEY is not available.");
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
        branding: buildBrandingDecision({
          captureAccepted: false,
          screenshot: null,
          openAiAvailable,
        }),
      };
      writeJson(path.join(candidateDir, "capture-summary.json"), skipped);
      captureResults.push(skipped);
      continue;
    }

    const captureAuth = captureAuthAvailable
      ? {
        enabled: true,
        loginUrl: buildCaptureLoginUrl(baseUrl, candidate.targetPath || contract.likelyApps?.[0]?.path || "/desktop"),
      }
      : { enabled: false, loginUrl: null };
    const task = buildBrowserUseTask({
      baseUrl,
      story,
      contract,
      captureAuth,
    });
    fs.writeFileSync(path.join(candidateDir, "browser-use-task.md"), `${task}\n`, "utf8");

    const result = await runBrowserUseTask({
      task,
      model: browserUseModel,
      outputDir: candidateDir,
      profileId: "",
      enableRecording,
      desktopViewport: contract.desktopCapturePolicy.viewport,
      maxCostUsd,
      useOutputSchema: true,
      sensitiveData: captureAuth.enabled ? { captureSecret } : null,
    });
    const desktopEvaluation = evaluateDesktopCapture({
      output: result.output,
      screenshot: result.screenshot,
      mediaEligibility: contract.mediaEligibility,
      minDesktopViewport: contract.desktopCapturePolicy.minimumViewport,
    });
    const captureAccepted = desktopEvaluation.ok;
    const summary = {
      candidate,
      status: captureAccepted ? "accepted" : "rejected",
      provider: "browser-use-cloud",
      model: browserUseModel,
      captureAccepted,
      result,
      desktopEvaluation,
      branding: buildBrandingDecision({
        captureAccepted,
        screenshot: result.screenshot,
        openAiAvailable,
      }),
    };
    writeJson(path.join(candidateDir, "capture-summary.json"), summary);
    captureResults.push(summary);
    if (strictCapture && !captureAccepted) {
      break;
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    changelogFile: resolvedChangelogFile,
    baseUrl: baseUrl || null,
    models: {
      anthropic: anthropicModel,
      browserUse: browserUseModel,
    },
    env: {
      anthropicAvailable: true,
      browserUseAvailable: browserUseKeyAvailable,
      openAiAvailable,
      captureAuthAvailable,
    },
    capturePreflight,
    counts: {
      changelogEntries: changelogEntries.length,
      rawCommits: Array.isArray(changelog?.rawCommits) ? changelog.rawCommits.length : 0,
      changedFiles: changedFiles.length,
      plannedCandidates: planning.plan.candidates.length,
      skippedByPlanner: planning.plan.skipped.length,
      plannerMissingEntries: planning.coverage.missing.length,
      plannerDuplicateEntries: planning.coverage.duplicate.length,
      plannerUnknownEntries: planning.coverage.unknown.length,
      captureAccepted: captureResults.filter((entry) => entry.captureAccepted).length,
      captureRejected: captureResults.filter((entry) => entry.status === "rejected").length,
      captureBlocked: captureResults.filter((entry) => entry.status === "blocked").length,
      brandingReady: captureResults.filter((entry) => entry.branding?.status === "ready").length,
      brandingReadyButNotRun: captureResults.filter((entry) => entry.branding?.status === "ready-but-not-run").length,
    },
    selectionCoverage: planning.coverage,
    plannerAttemptCount: planning.attempts.length,
    mediaPlan: planning.plan,
    captureResults: captureResults.map((entry) => ({
      entryId: entry.candidate?.entryId || null,
      title: entry.candidate?.title || null,
      status: entry.status,
      captureAccepted: entry.captureAccepted,
      blockers: entry.blockers || [],
      concerns: entry.desktopEvaluation?.concerns || [],
      screenshot: entry.result?.screenshot || null,
      branding: entry.branding || null,
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
    maxCandidates: Number.parseInt(String(args["max-candidates"] || "3"), 10) || 3,
    runBrowserUse: !isEnabled(args["plan-only"]),
    requireCaptureSecret: !isEnabled(args["allow-unauthenticated"]),
    anthropicModel: String(args["anthropic-model"] || process.env.CHANGELOG_MEDIA_ANTHROPIC_MODEL || "claude-opus-4-7").trim(),
    browserUseModel: String(args["browser-use-model"] || process.env.BROWSER_USE_MODEL || DEFAULT_BROWSER_USE_MODEL).trim(),
    maxCostUsd: args["max-cost-usd"] || process.env.BROWSER_USE_MAX_COST_USD || "",
    enableRecording: isEnabled(args["enable-recording"] || process.env.BROWSER_USE_ENABLE_RECORDING),
    strictCapture: isEnabled(args.strict),
  });
  console.log(JSON.stringify({
    ok: true,
    outputDir,
    counts: report.counts,
    env: report.env,
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
      blockers: entry.blockers,
      concerns: entry.concerns,
      branding: entry.branding?.status || null,
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
