#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { replaceChangelogMediaBlock } from "./publish-changelog-media.mjs";

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
  return String(value || "").trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isPublishedMedia(media) {
  return sanitizeText(media?.status) === "published" && Boolean(sanitizeText(media?.assetPath));
}

function isSameReleaseDoc(left, right) {
  return sanitizeText(left?.channel) === sanitizeText(right?.channel)
    && sanitizeText(left?.date) === sanitizeText(right?.date)
    && sanitizeText(left?.version) === sanitizeText(right?.version);
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join(path.posix.sep);
}

function buildHistoryAssetRef(markdownPath, pagesDir, assetPath) {
  const absoluteAssetPath = path.join(pagesDir, assetPath);
  return toPosixPath(path.relative(path.dirname(markdownPath), absoluteAssetPath));
}

function syncHistoryMediaFromLatest({
  latestDoc,
  historyDoc,
  historyMarkdown,
  historyMarkdownPath,
  pagesDir,
}) {
  const latestEntries = new Map(
    (Array.isArray(latestDoc?.rendered?.entries) ? latestDoc.rendered.entries : [])
      .map((entry) => [sanitizeText(entry?.media?.slotId || entry?.title), entry]),
  );

  let updatedSlots = 0;
  let nextMarkdown = historyMarkdown;

  const nextEntries = (Array.isArray(historyDoc?.rendered?.entries) ? historyDoc.rendered.entries : []).map((entry) => {
    const lookupKey = sanitizeText(entry?.media?.slotId || entry?.title);
    const latestEntry = latestEntries.get(lookupKey);
    if (!latestEntry || !isPublishedMedia(latestEntry.media)) {
      return entry;
    }

    const latestMedia = latestEntry.media;
    const historyMedia = entry?.media;
    const alreadySynced = sanitizeText(historyMedia?.status) === "published"
      && sanitizeText(historyMedia?.assetPath) === sanitizeText(latestMedia.assetPath)
      && sanitizeText(historyMedia?.updatedAt) === sanitizeText(latestMedia.updatedAt);
    if (alreadySynced) {
      return entry;
    }

    updatedSlots += 1;
    const nextMedia = {
      ...historyMedia,
      ...latestMedia,
    };

    nextMarkdown = replaceChangelogMediaBlock(
      nextMarkdown,
      nextMedia,
      [`![${nextMedia.alt}](${buildHistoryAssetRef(historyMarkdownPath, pagesDir, nextMedia.assetPath)})`],
    );

    return {
      ...entry,
      media: nextMedia,
    };
  });

  return {
    updatedSlots,
    historyDoc: {
      ...historyDoc,
      rendered: {
        ...historyDoc.rendered,
        entries: nextEntries,
      },
    },
    historyMarkdown: nextMarkdown,
  };
}

function syncChannel({ pagesDir, channel }) {
  const channelDir = path.join(pagesDir, "changelog", channel);
  const latestJsonPath = path.join(channelDir, "latest.json");
  const latestMarkdownPath = path.join(channelDir, "latest.md");
  if (!fs.existsSync(latestJsonPath) || !fs.existsSync(latestMarkdownPath)) {
    return null;
  }

  const latestDoc = readJson(latestJsonPath);
  const historyJsonPath = path.join(channelDir, "history", `${sanitizeText(latestDoc?.date)}.json`);
  const historyMarkdownPath = path.join(channelDir, "history", `${sanitizeText(latestDoc?.date)}.md`);
  if (!fs.existsSync(historyJsonPath) || !fs.existsSync(historyMarkdownPath)) {
    return null;
  }

  const historyDoc = readJson(historyJsonPath);
  if (!isSameReleaseDoc(latestDoc, historyDoc)) {
    return null;
  }

  const historyMarkdown = fs.readFileSync(historyMarkdownPath, "utf8");
  const result = syncHistoryMediaFromLatest({
    latestDoc,
    historyDoc,
    historyMarkdown,
    historyMarkdownPath,
    pagesDir,
  });
  if (result.updatedSlots === 0) {
    return {
      channel,
      date: sanitizeText(latestDoc?.date),
      version: sanitizeText(latestDoc?.version),
      updatedSlots: 0,
      files: [],
    };
  }

  writeJson(historyJsonPath, result.historyDoc);
  fs.writeFileSync(historyMarkdownPath, result.historyMarkdown, "utf8");
  return {
    channel,
    date: sanitizeText(latestDoc?.date),
    version: sanitizeText(latestDoc?.version),
    updatedSlots: result.updatedSlots,
    files: [
      path.relative(pagesDir, historyJsonPath),
      path.relative(pagesDir, historyMarkdownPath),
    ],
  };
}

function discoverChannels(pagesDir, requestedChannel) {
  if (requestedChannel) {
    return [requestedChannel];
  }

  const changelogRoot = path.join(pagesDir, "changelog");
  if (!fs.existsSync(changelogRoot)) {
    return [];
  }

  return fs.readdirSync(changelogRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function runSync({ pagesDir, channel }) {
  const results = discoverChannels(pagesDir, channel)
    .map((name) => syncChannel({ pagesDir, channel: name }))
    .filter(Boolean);

  return {
    pagesDir,
    channel: sanitizeText(channel) || null,
    updatedChannels: results.filter((result) => result.updatedSlots > 0).length,
    updatedSlots: results.reduce((sum, result) => sum + result.updatedSlots, 0),
    results,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pagesDir = path.resolve(args["pages-dir"] || ".");
  const channel = sanitizeText(args.channel || "");
  const summary = runSync({ pagesDir, channel });
  console.log(JSON.stringify(summary, null, 2));
}

export {
  buildHistoryAssetRef,
  isPublishedMedia,
  isSameReleaseDoc,
  parseArgs,
  runSync,
  syncHistoryMediaFromLatest,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
