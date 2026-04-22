#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MEDIA_BEGIN_PREFIX = "<!-- AURA_CHANGELOG_MEDIA:BEGIN ";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }
    const key = part.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function sanitizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function isEnabled(value, defaultValue = false) {
  const normalized = sanitizeText(value).toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return !["0", "false", "no", "off", "disabled"].includes(normalized);
}

function slugify(value, maxLength = 80) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return [...new Set(values)];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

function collectEntryChangedFiles(doc, entry) {
  const commitLookup = new Map((Array.isArray(doc?.rawCommits) ? doc.rawCommits : []).map((commit) => [commit.sha, commit]));
  return unique(
    (Array.isArray(entry?.items) ? entry.items : [])
      .flatMap((item) => Array.isArray(item?.commit_shas) ? item.commit_shas : [])
      .flatMap((sha) => commitLookup.get(sha)?.files || []),
  );
}

function buildEntryPrompt(entry) {
  const bullets = (Array.isArray(entry?.items) ? entry.items : [])
    .map((item) => sanitizeText(item?.text))
    .filter(Boolean);
  const storyParts = [
    sanitizeText(entry?.title),
    sanitizeText(entry?.summary),
    bullets.length ? `Key details: ${bullets.join(" ")}` : "",
    "Open the most relevant product surface for this changelog entry and leave the clearest proof visible for a polished desktop screenshot.",
    "Avoid placeholder routes, empty states, settings-only screens, and generic landing views.",
  ].filter(Boolean);

  return storyParts.join(" ");
}

function selectBestScreenshot(summary) {
  const repairPath = summary?.repair?.success ? summary?.repair?.screenshot?.path : null;
  if (repairPath) {
    return {
      path: repairPath,
      source: "repair",
    };
  }

  const preferredPhases = ["capture-proof", "validate-proof", "setup-state"];
  for (const phaseId of preferredPhases) {
    const phase = (Array.isArray(summary?.phases) ? summary.phases : []).find((candidate) => candidate?.id === phaseId);
    if (phase?.success && phase?.screenshot?.path) {
      return {
        path: phase.screenshot.path,
        source: phaseId,
      };
    }
  }

  const fallbackPath = Array.isArray(summary?.screenshots)
    ? summary.screenshots.find((screenshot) => screenshot?.path)?.path
    : null;
  if (fallbackPath) {
    return {
      path: fallbackPath,
      source: "fallback",
    };
  }

  return null;
}

function buildMediaMetadata(entry, assetPath, selectedScreenshot, summary) {
  return {
    slotId: entry.media.slotId,
    batchId: entry.batch_id,
    slug: entry.media.slug,
    alt: entry.media.alt,
    status: "published",
    assetPath,
    screenshotSource: selectedScreenshot.source,
    updatedAt: new Date().toISOString(),
    storyTitle: summary?.storyTitle || entry.title,
  };
}

function buildMediaBlock(metadata, bodyLines = []) {
  return [
    `${MEDIA_BEGIN_PREFIX}${JSON.stringify(metadata)} -->`,
    ...bodyLines,
    `<!-- AURA_CHANGELOG_MEDIA:END ${metadata.slotId} -->`,
  ].join("\n");
}

function replaceChangelogMediaBlock(markdown, metadata, bodyLines = []) {
  const pattern = new RegExp(
    `<!-- AURA_CHANGELOG_MEDIA:BEGIN [^\\n]*"slotId":"${escapeRegex(metadata.slotId)}"[^\\n]* -->[\\s\\S]*?<!-- AURA_CHANGELOG_MEDIA:END ${escapeRegex(metadata.slotId)} -->`,
  );
  const replacement = buildMediaBlock(metadata, bodyLines);
  if (!pattern.test(markdown)) {
    throw new Error(`Could not find changelog media placeholder for slot ${metadata.slotId}`);
  }
  return markdown.replace(pattern, replacement);
}

function updateEntryMedia(doc, slotId, updater) {
  return {
    ...doc,
    rendered: {
      ...doc.rendered,
      entries: (Array.isArray(doc?.rendered?.entries) ? doc.rendered.entries : []).map((entry) => {
        if (entry?.media?.slotId !== slotId) {
          return entry;
        }
        return {
          ...entry,
          media: updater(entry.media, entry),
        };
      }),
    },
  };
}

function isSameReleaseDoc(a, b) {
  return sanitizeText(a?.date) === sanitizeText(b?.date)
    && sanitizeText(a?.version) === sanitizeText(b?.version)
    && sanitizeText(a?.channel) === sanitizeText(b?.channel);
}

function findHistoryJsonPathByVersion(historyDir, version) {
  if (!version || !fs.existsSync(historyDir)) {
    return null;
  }

  for (const entry of fs.readdirSync(historyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const candidatePath = path.join(historyDir, entry.name);
    const candidate = readJson(candidatePath);
    if (sanitizeText(candidate?.version) === version) {
      return candidatePath;
    }
  }

  return null;
}

function resolveTargetChangelogDocs(channelDir, requestedDate, requestedVersion) {
  const latestJsonPath = path.join(channelDir, "latest.json");
  const latestMarkdownPath = path.join(channelDir, "latest.md");
  const latestDoc = readJson(latestJsonPath);
  const historyDir = path.join(channelDir, "history");
  const normalizedDate = sanitizeText(requestedDate);
  const normalizedVersion = sanitizeText(requestedVersion);

  let targetJsonPath = latestJsonPath;
  if (normalizedDate) {
    targetJsonPath = path.join(historyDir, `${normalizedDate}.json`);
  } else if (normalizedVersion && sanitizeText(latestDoc?.version) !== normalizedVersion) {
    targetJsonPath = findHistoryJsonPathByVersion(historyDir, normalizedVersion);
    if (!targetJsonPath) {
      throw new Error(`Could not find changelog history entry for version ${normalizedVersion}`);
    }
  }

  if (!fs.existsSync(targetJsonPath)) {
    throw new Error(`Could not find changelog document at ${targetJsonPath}`);
  }

  const targetDoc = targetJsonPath === latestJsonPath ? latestDoc : readJson(targetJsonPath);
  const targetDate = sanitizeText(targetDoc?.date);
  const targetVersion = sanitizeText(targetDoc?.version);
  const targetMarkdownPath = targetJsonPath === latestJsonPath
    ? latestMarkdownPath
    : path.join(historyDir, `${targetDate}.md`);

  return {
    latest: {
      doc: latestDoc,
      jsonPath: latestJsonPath,
      markdownPath: latestMarkdownPath,
    },
    target: {
      doc: targetDoc,
      jsonPath: targetJsonPath,
      markdownPath: targetMarkdownPath,
      date: targetDate,
      version: targetVersion,
      isLatest: isSameReleaseDoc(latestDoc, targetDoc),
    },
  };
}

function resolveAssetPath({ channel, version, date, slotId, sourcePath }) {
  const extension = path.extname(sourcePath) || ".png";
  return path.posix.join("assets", "changelog", channel, version || date || "latest", `${slotId}${extension}`);
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join(path.posix.sep);
}

function relativeAssetReference(markdownPath, pagesDir, assetPath) {
  const absoluteAssetPath = path.join(pagesDir, assetPath);
  return toPosixPath(path.relative(path.dirname(markdownPath), absoluteAssetPath));
}

function isBrowserbaseConcurrencyError(output) {
  return /max concurrent sessions limit|RateLimitError|status:\s*429/i.test(String(output || ""));
}

function isBrowserbaseQuotaError(output) {
  return /status:\s*402|payment required|browser minutes limit reached|upgrade your account/i.test(String(output || ""));
}

function allowLocalFallbackOnBrowserbaseQuota() {
  return isEnabled(process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK, true);
}

function buildAbortRemainingError(message, options = {}) {
  const error = new Error(message);
  error.abortRemaining = true;
  error.skipReason = options.skipReason || message;
  error.code = options.code || "CAPTURE_ABORT_REMAINING";
  if (options.cause) {
    error.cause = options.cause;
  }
  return error;
}

function shouldPublishEntryMedia(entry, pagesDir, { refreshExisting = false } = {}) {
  if (!entry?.media?.requested) {
    return {
      publish: false,
      reason: "entry does not request changelog media",
    };
  }

  if (refreshExisting) {
    return {
      publish: true,
      reason: "refresh_existing requested",
    };
  }

  const status = sanitizeText(entry.media.status || "pending");
  const assetPath = sanitizeText(entry.media.assetPath);
  if (status !== "published") {
    return {
      publish: true,
      reason: `media status is ${status || "pending"}`,
    };
  }

  if (!assetPath) {
    return {
      publish: true,
      reason: "published media is missing assetPath",
    };
  }

  if (!fs.existsSync(path.join(pagesDir, assetPath))) {
    return {
      publish: true,
      reason: `asset file ${assetPath} is missing`,
    };
  }

  return {
    publish: false,
    reason: "published media asset already exists",
  };
}

function findProductionSummary(outputRoot) {
  const stack = [outputRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile() && entry.name === "production-summary.json") {
        return nextPath;
      }
    }
  }
  return null;
}

function runScreenshotCapture({
  repoDir,
  previewUrl,
  provider,
  channel,
  profile,
  prompt,
  changedFiles,
  slotId,
}) {
  const interfaceDir = path.join(repoDir, "interface");
  const baseRunRoot = path.join(interfaceDir, "output", "demo-screenshots", "publish-changelog-media");
  const runStamp = `${slotId}-${Date.now()}`;

  const runCaptureAttempt = (captureProvider) => {
    const runRoot = path.join(baseRunRoot, `${runStamp}-${captureProvider}`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-changelog-media-"));
    const changedFilesPath = path.join(tempDir, "changed-files.json");
    writeJson(changedFilesPath, changedFiles);
    ensureDir(runRoot);

    const commandArgs = [
      "./scripts/produce-agent-demo-screenshots.mjs",
      "--prompt",
      prompt,
      "--channel",
      channel,
      "--base-url",
      previewUrl,
      "--provider",
      captureProvider,
      "--output-dir",
      runRoot,
      "--changed-files-file",
      changedFilesPath,
    ];

    if (profile) {
      commandArgs.push("--profile", profile);
    }

    try {
      const maxAttempts = captureProvider === "browserbase" ? 3 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          execFileSync("node", commandArgs, {
            cwd: interfaceDir,
            stdio: "pipe",
            encoding: "utf8",
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
          });
          const summaryPath = findProductionSummary(runRoot);
          if (!summaryPath) {
            throw new Error(`Could not find production-summary.json under ${runRoot}`);
          }
          return readJson(summaryPath);
        } catch (error) {
          const output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
          const shouldRetryConcurrency = captureProvider === "browserbase"
            && isBrowserbaseConcurrencyError(output)
            && attempt < maxAttempts;
          if (!shouldRetryConcurrency) {
            error.captureProvider = captureProvider;
            error.captureOutput = output;
            throw error;
          }
          const backoffMs = attempt * 30_000;
          console.warn(`Browserbase session capacity is full. Retrying screenshot capture in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts}).`);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs);
        }
      }
      throw new Error(`Screenshot capture attempt unexpectedly completed without producing a summary for ${captureProvider}.`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  try {
    return runCaptureAttempt(provider);
  } catch (error) {
    const output = error?.captureOutput || [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
    const isQuotaFailure = provider === "browserbase" && isBrowserbaseQuotaError(output);
    if (!isQuotaFailure) {
      throw error;
    }

    if (!allowLocalFallbackOnBrowserbaseQuota()) {
      throw buildAbortRemainingError(
        "Browserbase browser minutes are exhausted and local fallback is disabled.",
        {
          code: "BROWSERBASE_QUOTA_EXHAUSTED",
          skipReason: "Skipping remaining media captures because Browserbase browser minutes are exhausted.",
          cause: error,
        },
      );
    }

    console.warn("Browserbase browser minutes are exhausted. Falling back to the local capture provider.");

    try {
      return runCaptureAttempt("local");
    } catch (fallbackError) {
      throw buildAbortRemainingError(
        "Browserbase browser minutes are exhausted and the local capture fallback failed.",
        {
          code: "BROWSERBASE_QUOTA_EXHAUSTED",
          skipReason: "Skipping remaining media captures because Browserbase browser minutes are exhausted and the local fallback could not recover.",
          cause: fallbackError,
        },
      );
    }
  }
}

function publishEntryMedia({
  repoDir,
  pagesDir,
  doc,
  latestMarkdownPath,
  historyMarkdownPath,
  entry,
  previewUrl,
  provider,
  profile,
}) {
  const prompt = buildEntryPrompt(entry);
  const changedFiles = collectEntryChangedFiles(doc, entry);
  const summary = runScreenshotCapture({
    repoDir,
    previewUrl,
    provider,
    channel: doc.channel,
    profile,
    prompt,
    changedFiles,
    slotId: entry.media.slotId,
  });

  if (!summary?.ok) {
    throw new Error(`Screenshot capture did not produce a passing summary for ${entry.media.slotId}`);
  }

  const selectedScreenshot = selectBestScreenshot(summary);
  if (!selectedScreenshot?.path || !fs.existsSync(selectedScreenshot.path)) {
    throw new Error(`No publishable screenshot was produced for ${entry.media.slotId}`);
  }

  const assetPath = resolveAssetPath({
    channel: doc.channel,
    version: doc.version,
    date: doc.date,
    slotId: entry.media.slotId,
    sourcePath: selectedScreenshot.path,
  });
  const absoluteAssetPath = path.join(pagesDir, assetPath);
  ensureDir(path.dirname(absoluteAssetPath));
  fs.copyFileSync(selectedScreenshot.path, absoluteAssetPath);

  const metadata = buildMediaMetadata(entry, assetPath, selectedScreenshot, summary);
  const latestImageRef = relativeAssetReference(latestMarkdownPath, pagesDir, assetPath);
  const historyImageRef = relativeAssetReference(historyMarkdownPath, pagesDir, assetPath);

  const latestMarkdown = replaceChangelogMediaBlock(
    readText(latestMarkdownPath),
    metadata,
    [`![${metadata.alt}](${latestImageRef})`],
  );
  const historyMarkdown = replaceChangelogMediaBlock(
    readText(historyMarkdownPath),
    metadata,
    [`![${metadata.alt}](${historyImageRef})`],
  );
  writeText(latestMarkdownPath, latestMarkdown);
  writeText(historyMarkdownPath, historyMarkdown);

  return {
    metadata,
    summary,
    selectedScreenshot,
    prompt,
    changedFiles,
  };
}

function buildRunSummary(results) {
  return {
    generatedAt: new Date().toISOString(),
    attempted: results.length,
    published: results.filter((result) => result.status === "published").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = path.resolve(args["repo-dir"] || ".");
  const pagesDir = path.resolve(args["pages-dir"] || ".");
  const channel = sanitizeText(args.channel || "nightly");
  const previewUrl = sanitizeText(args["preview-url"] || process.env.AURA_DEMO_SCREENSHOT_BASE_URL);
  const provider = sanitizeText(args.provider || (process.env.BROWSERBASE_API_KEY ? "browserbase" : "local")) || "local";
  const profile = sanitizeText(args.profile || "");
  const date = sanitizeText(args.date || "");
  const version = sanitizeText(args.version || "");
  const refreshExisting = args["refresh-existing"] === true;

  if (!previewUrl) {
    throw new Error("A preview URL is required. Pass --preview-url or set AURA_DEMO_SCREENSHOT_BASE_URL.");
  }

  const channelDir = path.join(pagesDir, "changelog", channel);
  const changelogDocs = resolveTargetChangelogDocs(channelDir, date, version);
  const effectiveDate = changelogDocs.target.date;
  const effectiveVersion = changelogDocs.target.version;
  let targetDoc = changelogDocs.target.doc;
  let latestDoc = changelogDocs.latest.doc;
  const candidateEntries = Array.isArray(targetDoc?.rendered?.entries) ? targetDoc.rendered.entries : [];

  const results = [];
  let abortRemainingReason = null;
  for (const entry of candidateEntries) {
    if (abortRemainingReason) {
      results.push({
        slotId: entry?.media?.slotId || entry?.batch_id || entry?.title || "entry",
        title: entry?.title || "Untitled entry",
        status: "skipped",
        reason: abortRemainingReason,
      });
      continue;
    }

    const decision = shouldPublishEntryMedia(entry, pagesDir, { refreshExisting });
    if (!decision.publish) {
      results.push({
        slotId: entry?.media?.slotId || entry?.batch_id || entry?.title || "entry",
        title: entry?.title || "Untitled entry",
        status: "skipped",
        reason: decision.reason,
      });
      continue;
    }

    try {
      const published = publishEntryMedia({
        repoDir,
        pagesDir,
        doc: targetDoc,
        latestMarkdownPath: changelogDocs.target.isLatest ? changelogDocs.latest.markdownPath : changelogDocs.target.markdownPath,
        historyMarkdownPath: changelogDocs.target.markdownPath,
        entry,
        previewUrl,
        provider,
        profile,
      });

      targetDoc = updateEntryMedia(targetDoc, entry.media.slotId, (media) => ({
        ...media,
        ...published.metadata,
      }));
      if (changelogDocs.target.isLatest) {
        latestDoc = targetDoc;
      } else if (isSameReleaseDoc(latestDoc, targetDoc)) {
        latestDoc = updateEntryMedia(latestDoc, entry.media.slotId, (media) => ({
          ...media,
          ...published.metadata,
        }));
      }

      results.push({
        slotId: entry.media.slotId,
        title: entry.title,
        status: "published",
        assetPath: published.metadata.assetPath,
        screenshotSource: published.selectedScreenshot.source,
      });
    } catch (error) {
      targetDoc = updateEntryMedia(targetDoc, entry.media.slotId, (media) => ({
        ...media,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: String(error),
      }));
      if (changelogDocs.target.isLatest) {
        latestDoc = targetDoc;
      } else if (isSameReleaseDoc(latestDoc, targetDoc)) {
        latestDoc = updateEntryMedia(latestDoc, entry.media.slotId, (media) => ({
          ...media,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: String(error),
        }));
      }
      results.push({
        slotId: entry.media.slotId,
        title: entry.title,
        status: "failed",
        error: String(error),
      });

      if (error?.abortRemaining) {
        abortRemainingReason = error.skipReason || "Skipping remaining media captures after an unrecoverable provider failure.";
      }
    }
  }

  writeJson(changelogDocs.target.jsonPath, targetDoc);
  if (changelogDocs.target.isLatest) {
    writeJson(changelogDocs.latest.jsonPath, targetDoc);
  } else if (isSameReleaseDoc(latestDoc, targetDoc)) {
    writeJson(changelogDocs.latest.jsonPath, latestDoc);
  }

  const summary = buildRunSummary(results);
  console.log(JSON.stringify({
    ...summary,
    channel,
    date: effectiveDate,
    version: effectiveVersion || null,
  }, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

export {
  allowLocalFallbackOnBrowserbaseQuota,
  buildEntryPrompt,
  buildAbortRemainingError,
  buildMediaBlock,
  buildRunSummary,
  isBrowserbaseConcurrencyError,
  isBrowserbaseQuotaError,
  isEnabled,
  parseArgs,
  resolveTargetChangelogDocs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
  shouldPublishEntryMedia,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
