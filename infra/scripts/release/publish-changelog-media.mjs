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
  const runRoot = path.join(interfaceDir, "output", "demo-screenshots", "publish-changelog-media", `${slotId}-${Date.now()}`);
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
    provider,
    "--output-dir",
    runRoot,
    "--changed-files-file",
    changedFilesPath,
  ];

  if (profile) {
    commandArgs.push("--profile", profile);
  }

  try {
    const maxAttempts = provider === "browserbase" ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        execFileSync("node", commandArgs, {
          cwd: interfaceDir,
          stdio: "pipe",
          encoding: "utf8",
          env: process.env,
          maxBuffer: 10 * 1024 * 1024,
        });
        break;
      } catch (error) {
        const output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
        const isBrowserbaseConcurrencyError = provider === "browserbase"
          && /max concurrent sessions limit|RateLimitError|status:\s*429/i.test(output);
        if (!isBrowserbaseConcurrencyError || attempt === maxAttempts) {
          throw error;
        }
        const backoffMs = attempt * 30_000;
        console.warn(`Browserbase session capacity is full. Retrying screenshot capture in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts}).`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs);
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const summaryPath = findProductionSummary(runRoot);
  if (!summaryPath) {
    throw new Error(`Could not find production-summary.json under ${runRoot}`);
  }
  return readJson(summaryPath);
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

  if (!previewUrl) {
    throw new Error("A preview URL is required. Pass --preview-url or set AURA_DEMO_SCREENSHOT_BASE_URL.");
  }

  const channelDir = path.join(pagesDir, "changelog", channel);
  const latestJsonPath = path.join(channelDir, "latest.json");
  const latestMarkdownPath = path.join(channelDir, "latest.md");
  const doc = readJson(latestJsonPath);
  const effectiveDate = date || sanitizeText(doc.date);
  const effectiveVersion = version || sanitizeText(doc.version);
  const historyJsonPath = path.join(channelDir, "history", `${effectiveDate}.json`);
  const historyMarkdownPath = path.join(channelDir, "history", `${effectiveDate}.md`);

  let latestDoc = doc;
  let historyDoc = readJson(historyJsonPath);
  const candidateEntries = (Array.isArray(doc?.rendered?.entries) ? doc.rendered.entries : [])
    .filter((entry) => entry?.media?.requested);

  const results = [];
  for (const entry of candidateEntries) {
    try {
      const published = publishEntryMedia({
        repoDir,
        pagesDir,
        doc: latestDoc,
        latestMarkdownPath,
        historyMarkdownPath,
        entry,
        previewUrl,
        provider,
        profile,
      });

      latestDoc = updateEntryMedia(latestDoc, entry.media.slotId, (media) => ({
        ...media,
        ...published.metadata,
      }));
      historyDoc = updateEntryMedia(historyDoc, entry.media.slotId, (media) => ({
        ...media,
        ...published.metadata,
      }));

      results.push({
        slotId: entry.media.slotId,
        title: entry.title,
        status: "published",
        assetPath: published.metadata.assetPath,
        screenshotSource: published.selectedScreenshot.source,
      });
    } catch (error) {
      latestDoc = updateEntryMedia(latestDoc, entry.media.slotId, (media) => ({
        ...media,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: String(error),
      }));
      historyDoc = updateEntryMedia(historyDoc, entry.media.slotId, (media) => ({
        ...media,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: String(error),
      }));
      results.push({
        slotId: entry.media.slotId,
        title: entry.title,
        status: "failed",
        error: String(error),
      });
    }
  }

  writeJson(latestJsonPath, latestDoc);
  writeJson(historyJsonPath, historyDoc);

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
  buildEntryPrompt,
  buildMediaBlock,
  buildRunSummary,
  parseArgs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
