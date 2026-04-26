#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeEntryId(entry, index) {
  return String(entry?.batch_id || entry?.id || entry?.entryId || `entry-${index + 1}`).trim();
}

function safeName(value) {
  return String(value || "media")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "media";
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function entryCommitShas(entry) {
  return [...new Set(
    (Array.isArray(entry?.items) ? entry.items : [])
      .flatMap((item) => item?.commit_shas || item?.commitShas || [])
      .map((sha) => String(sha || "").trim())
      .filter(Boolean),
  )];
}

function isPublishedMedia(media) {
  if (!media || typeof media !== "object") return false;
  return String(media.status || "").toLowerCase() === "published"
    && Boolean(String(media.assetPath || media.asset_path || media.url || media.src || "").trim());
}

function relativeAssetPath({ channel, date, entryId, hash }) {
  return path.posix.join(
    "assets",
    "changelog",
    safeName(channel),
    safeName(date),
    `${safeName(entryId)}-${hash.slice(0, 12)}.png`,
  );
}

function findEntry(doc, entryId) {
  const entries = Array.isArray(doc?.rendered?.entries) ? doc.rendered.entries : [];
  const index = entries.findIndex((entry, entryIndex) => normalizeEntryId(entry, entryIndex) === entryId);
  return index >= 0 ? { entry: entries[index], index } : null;
}

function applyMediaToDoc({
  doc,
  asset,
  assetPath,
  refreshExisting = false,
  generatedAt,
}) {
  const entryId = String(asset?.entryId || "").trim();
  const match = findEntry(doc, entryId);
  if (!match) {
    return { status: "missing-entry", entryId };
  }

  if (!refreshExisting && isPublishedMedia(match.entry.media)) {
    return {
      status: "skipped-existing",
      entryId,
      assetPath: match.entry.media.assetPath || match.entry.media.asset_path || null,
    };
  }

  const sourceCommitShas = entryCommitShas(match.entry);
  match.entry.media = {
    schemaVersion: 1,
    status: "published",
    type: "image",
    assetPath,
    alt: asset?.title || match.entry.title || "Aura changelog media",
    caption: asset?.publicCaption || match.entry.summary || "",
    width: asset?.dimensions?.width || null,
    height: asset?.dimensions?.height || null,
    bytes: asset?.bytes || null,
    sourceCommitShas,
    gates: asset?.gates || null,
    updatedAt: generatedAt,
  };

  return {
    status: "published",
    entryId,
    assetPath,
    sourceCommitShas,
  };
}

export function publishChangelogMedia({
  manifestFile,
  pagesDir,
  channel,
  date,
  refreshExisting = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!manifestFile) throw new Error("manifestFile is required.");
  if (!pagesDir) throw new Error("pagesDir is required.");
  if (!channel) throw new Error("channel is required.");

  const manifest = readJson(manifestFile);
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const latestPath = path.join(pagesDir, "changelog", channel, "latest.json");
  const latestDoc = readJson(latestPath);
  const resolvedDate = String(date || latestDoc.date || "").trim();
  if (!resolvedDate) throw new Error("date is required or must exist in latest changelog JSON.");
  const historyPath = path.join(pagesDir, "changelog", channel, "history", `${resolvedDate}.json`);
  const historyDoc = fs.existsSync(historyPath) ? readJson(historyPath) : null;

  const results = [];
  for (const asset of assets) {
    const sourcePath = asset?.source?.brandedPngPath;
    const entryId = String(asset?.entryId || "").trim();
    if (!entryId || !sourcePath || !fs.existsSync(sourcePath)) {
      results.push({ status: "missing-source", entryId, sourcePath: sourcePath || null });
      continue;
    }

    const latestMatch = findEntry(latestDoc, entryId);
    if (!latestMatch) {
      results.push({ status: "missing-entry", entryId });
      continue;
    }
    if (!refreshExisting && isPublishedMedia(latestMatch.entry.media)) {
      results.push({
        status: "skipped-existing",
        entryId,
        assetPath: latestMatch.entry.media.assetPath || latestMatch.entry.media.asset_path || null,
      });
      continue;
    }

    const hash = sha256File(sourcePath);
    const assetPath = relativeAssetPath({ channel, date: resolvedDate, entryId, hash });
    const destinationPath = path.join(pagesDir, assetPath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);

    const latestResult = applyMediaToDoc({
      doc: latestDoc,
      asset,
      assetPath,
      refreshExisting,
      generatedAt,
    });
    const historyResult = historyDoc
      ? applyMediaToDoc({
        doc: historyDoc,
        asset,
        assetPath,
        refreshExisting,
        generatedAt,
      })
      : { status: "history-missing", entryId };
    results.push({
      ...latestResult,
      historyStatus: historyResult.status,
      bytes: fs.statSync(destinationPath).size,
    });
  }

  writeJson(latestPath, latestDoc);
  if (historyDoc) writeJson(historyPath, historyDoc);

  return {
    ok: true,
    channel,
    date: resolvedDate,
    assetCount: assets.length,
    publishedCount: results.filter((result) => result.status === "published").length,
    skippedExistingCount: results.filter((result) => result.status === "skipped-existing").length,
    missingCount: results.filter((result) => result.status.startsWith("missing")).length,
    results,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = publishChangelogMedia({
    manifestFile: path.resolve(String(args["manifest-file"] || "")),
    pagesDir: path.resolve(String(args["pages-dir"] || "")),
    channel: String(args.channel || ""),
    date: String(args.date || ""),
    refreshExisting: isEnabled(args["refresh-existing"] || process.env.CHANGELOG_MEDIA_REFRESH_EXISTING),
  });
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
