#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) {
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args["repo-dir"] || ".");
const pagesDir = path.resolve(args["pages-dir"] || ".");
const artifactsDir = args["artifacts-dir"] ? path.resolve(args["artifacts-dir"]) : null;
const channel = String(args.channel || "nightly");
const version = args.version ? String(args.version) : null;
const releaseUrl = String(args["release-url"] || "");
const timeZone = String(args.timezone || process.env.CHANGELOG_TIMEZONE || "America/Los_Angeles");
const repoName = String(args.repo || path.basename(repoDir));
const promptVersion = 2;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
const anthropicModel = process.env.CHANGELOG_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
const BATCH_WINDOW_MINUTES = 120;
const SOFT_BATCH_WINDOW_MINUTES = 45;
const MAX_BATCH_SPAN_MINUTES = 180;
const MAX_BATCH_COMMITS = 8;
const TARGET_MAX_BATCHES = 8;

if (!fs.existsSync(repoDir)) {
  console.error(`repo directory not found: ${repoDir}`);
  process.exit(1);
}

if (!fs.existsSync(pagesDir)) {
  console.error(`pages directory not found: ${pagesDir}`);
  process.exit(1);
}

function runGit(gitArgs) {
  return execFileSync("git", gitArgs, {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function formatDateInTimeZone(date, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function trimText(text, { maxChars = 12000, maxLines = 160 } = {}) {
  const lines = text.split("\n");
  const truncatedLines = lines.slice(0, maxLines);
  let joined = truncatedLines.join("\n");
  if (joined.length > maxChars) {
    joined = `${joined.slice(0, maxChars)}\n... [truncated]`;
  } else if (lines.length > maxLines) {
    joined = `${joined}\n... [truncated]`;
  }
  return joined;
}

function sanitizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function unique(values) {
  return [...new Set(values)];
}

function intersect(a, b) {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value));
}

function inferAreas(files) {
  const counts = new Map();
  const bump = (name) => counts.set(name, (counts.get(name) || 0) + 1);

  for (const file of files) {
    if (file.startsWith("apps/aura-os-desktop/")) bump("Desktop");
    else if (file.startsWith("interface/ios/")) bump("iOS");
    else if (file.startsWith("interface/android/")) bump("Android");
    else if (file.startsWith("interface/src/") || file.startsWith("interface/tests/")) bump("Interface");
    else if (file.startsWith(".github/workflows/") || file.startsWith("infra/scripts/release/")) bump("Release Infrastructure");
    else if (file.startsWith("crates/")) bump("Core Rust");
    else if (file.startsWith("docs/")) bump("Docs");
    else bump("Other");
  }

  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return {
    primary: ordered[0] || "Other",
    areas: ordered,
  };
}

function cleanSubject(subject) {
  return sanitizeText(subject)
    .replace(/^(feat|fix|chore|refactor|docs|test|ci|build)(\(.+?\))?:\s*/i, "")
    .replace(/\.$/, "");
}

function toTitleCase(value) {
  return sanitizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractKeywords(value) {
  return unique(
    cleanSubject(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4),
  );
}

function fileGroup(file) {
  const parts = file.split("/");
  return parts.slice(0, Math.min(parts.length, 3)).join("/");
}

function collectCommit(sha) {
  const meta = runGit([
    "show",
    "-s",
    `--format=%H%x00%an%x00%ae%x00%cI%x00%s%x00%b`,
    sha,
  ]).split("\u0000");

  const files = runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const numstatRaw = runGit(["show", "--numstat", "--format=", sha]);
  let insertions = 0;
  let deletions = 0;
  for (const line of numstatRaw.split("\n")) {
    const [adds, dels] = line.split("\t");
    if (!adds || !dels) continue;
    if (adds !== "-") insertions += Number(adds) || 0;
    if (dels !== "-") deletions += Number(dels) || 0;
  }

  const parentsLine = runGit(["rev-list", "--parents", "-n", "1", sha]);
  const parents = parentsLine.split(" ").slice(1).filter(Boolean);
  const areaInfo = inferAreas(files);

  return {
    sha,
    author: {
      name: sanitizeText(meta[1]),
      email: sanitizeText(meta[2]),
    },
    committedAt: sanitizeText(meta[3]),
    subject: sanitizeText(meta[4]),
    body: sanitizeText(meta[5]),
    parents,
    files,
    stats: {
      fileCount: files.length,
      insertions,
      deletions,
    },
    committedAtMs: Date.parse(sanitizeText(meta[3])),
    cleanSubject: cleanSubject(meta[4]),
    keywords: extractKeywords(meta[4]),
    fileGroups: unique(files.map(fileGroup)),
    primaryArea: areaInfo.primary,
    areas: areaInfo.areas,
  };
}

function scoreCommit(commit) {
  let score = commit.stats.insertions + commit.stats.deletions + commit.stats.fileCount * 5;
  if (commit.primaryArea === "Release Infrastructure") score += 120;
  if (commit.primaryArea === "Desktop") score += 100;
  if (commit.primaryArea === "Interface") score += 90;
  if (commit.primaryArea === "iOS" || commit.primaryArea === "Android") score += 80;
  if (/update|release|sign|notariz|fix|support|improv|workflow|build/i.test(commit.subject)) score += 40;
  if (/typo|format|lint/i.test(commit.subject)) score -= 30;
  return score;
}

function collectPatchExcerpt(sha) {
  const shown = runGit(["show", "--stat", "--unified=2", "--format=medium", "--no-color", sha]);
  return trimText(shown, { maxChars: 12000, maxLines: 140 });
}

function collectArtifactSummaries(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((name) => /^release-summary-.*\.json$/i.test(name))
    .sort()
    .map((name) => {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        return {
          file: name,
          channel: json.channel ?? null,
          version: json.version ?? null,
          artifactCount: json.artifactCount ?? 0,
          artifacts: Array.isArray(json.artifacts)
            ? json.artifacts.map((artifact) => ({
                name: artifact.name,
                platform: artifact.platform,
                kind: artifact.kind,
                sizeBytes: artifact.sizeBytes,
              }))
            : [],
        };
      } catch (error) {
        return {
          file: name,
          parseError: String(error),
        };
      }
    });
}

function summarizeAreas(commits) {
  const counts = new Map();
  for (const commit of commits) {
    counts.set(commit.primaryArea, (counts.get(commit.primaryArea) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([area, count]) => ({ area, count }));
}

function formatTimeLabel(date, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function commitRelatedness(a, b) {
  let score = 0;
  if (a.primaryArea === b.primaryArea) score += 3;
  score += intersect(a.areas, b.areas).length;
  score += intersect(a.fileGroups, b.fileGroups).length * 2;
  score += intersect(a.keywords, b.keywords).length;
  if (a.author.email && a.author.email === b.author.email) score += 0.5;
  return score;
}

function batchRelatedness(batch, commit) {
  const lastCommit = batch.commits[batch.commits.length - 1];
  const dominantArea = batch.areaSummary[0]?.area;
  let score = commitRelatedness(lastCommit, commit);
  if (dominantArea && commit.areas.includes(dominantArea)) score += 1;
  if (batch.fileGroups.some((group) => commit.fileGroups.includes(group))) score += 2;
  return score;
}

function buildRawBatches(commits) {
  const sorted = [...commits].sort((a, b) => a.committedAtMs - b.committedAtMs);
  const batches = [];

  for (const commit of sorted) {
    const lastBatch = batches[batches.length - 1];
    if (!lastBatch) {
      batches.push({
        commits: [commit],
        startedAtMs: commit.committedAtMs,
        endedAtMs: commit.committedAtMs,
        fileGroups: [...commit.fileGroups],
        areaSummary: summarizeAreas([commit]),
      });
      continue;
    }

    const minutesSinceLast = (commit.committedAtMs - lastBatch.endedAtMs) / 60000;
    const batchSpanMinutes = (commit.committedAtMs - lastBatch.startedAtMs) / 60000;
    const relatedness = batchRelatedness(lastBatch, commit);
    const shouldMerge = (
      lastBatch.commits.length < MAX_BATCH_COMMITS &&
      batchSpanMinutes <= MAX_BATCH_SPAN_MINUTES &&
      (
        (minutesSinceLast <= SOFT_BATCH_WINDOW_MINUTES && relatedness >= 1) ||
        (minutesSinceLast <= BATCH_WINDOW_MINUTES && relatedness >= 3)
      )
    );

    if (shouldMerge) {
      lastBatch.commits.push(commit);
      lastBatch.endedAtMs = commit.committedAtMs;
      lastBatch.fileGroups = unique([...lastBatch.fileGroups, ...commit.fileGroups]);
      lastBatch.areaSummary = summarizeAreas(lastBatch.commits);
      continue;
    }

    batches.push({
      commits: [commit],
      startedAtMs: commit.committedAtMs,
      endedAtMs: commit.committedAtMs,
      fileGroups: [...commit.fileGroups],
      areaSummary: summarizeAreas([commit]),
    });
  }

  return batches;
}

function adjacentBatchMergeScore(left, right) {
  const leftArea = left.areaSummary[0]?.area || "";
  const rightArea = right.areaSummary[0]?.area || "";
  const minutesBetween = Math.max(0, (right.startedAtMs - left.endedAtMs) / 60000);
  let score = 0;
  if (leftArea && leftArea === rightArea) score += 6;
  if (intersect(left.fileGroups, right.fileGroups).length > 0) score += 4;
  score += intersect(
    unique(left.commits.flatMap((commit) => commit.keywords)),
    unique(right.commits.flatMap((commit) => commit.keywords)),
  ).length;
  if (minutesBetween <= 240) score += 2;
  if (left.commits.length <= 2 || right.commits.length <= 2) score += 1;
  return score;
}

function mergeAdjacentBatches(batches) {
  if (batches.length <= TARGET_MAX_BATCHES) {
    return batches;
  }

  const merged = [...batches];
  while (merged.length > TARGET_MAX_BATCHES) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < merged.length - 1; index += 1) {
      const score = adjacentBatchMergeScore(merged[index], merged[index + 1]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const left = merged[bestIndex];
    const right = merged[bestIndex + 1];
    const combinedCommits = [...left.commits, ...right.commits]
      .sort((a, b) => a.committedAtMs - b.committedAtMs);

    merged.splice(bestIndex, 2, {
      commits: combinedCommits,
      startedAtMs: combinedCommits[0].committedAtMs,
      endedAtMs: combinedCommits[combinedCommits.length - 1].committedAtMs,
      fileGroups: unique([...left.fileGroups, ...right.fileGroups]),
      areaSummary: summarizeAreas(combinedCommits),
    });
  }

  return merged;
}

function batchCommits(commits, tz) {
  const batches = mergeAdjacentBatches(buildRawBatches(commits));
  return batches.map((batch, index) => ({
    id: `entry-${index + 1}`,
    time_label: formatTimeLabel(new Date(batch.startedAtMs), tz),
    started_at: new Date(batch.startedAtMs).toISOString(),
    ended_at: new Date(batch.endedAtMs).toISOString(),
    area_summary: batch.areaSummary,
    commits: batch.commits,
  }));
}

function shouldIgnoreCommitForRendering(commit) {
  const subject = commit.subject.toLowerCase();
  if (commit.parents.length > 1) return true;
  if (/^merge (branch|pull request|remote-tracking)/i.test(commit.subject)) return true;
  if (/^merge /.test(subject)) return true;
  if (/^(format|fmt|lint|typo)\b/i.test(commit.cleanSubject)) return true;
  if (/rustfmt|prettier|eslint --fix|formatting/i.test(subject)) return true;
  if (/^bump .* version$/i.test(commit.cleanSubject)) return true;
  return false;
}

function buildHeadlineFromBatch(batch) {
  const topArea = batch.area_summary[0]?.area || "Product";
  const secondArea = batch.area_summary[1]?.area || "";
  const topSubjects = unique(batch.commits.map((commit) => commit.cleanSubject)).slice(0, 2);
  if (topArea === "Release Infrastructure") {
    return batch.commits.length > 1
      ? "Release Pipeline Reliability Improvements"
      : "Release Workflow Improvements";
  }
  if (topArea === "Interface" && secondArea === "Core Rust") {
    return "Interface and Runtime Flow Improvements";
  }
  if (topArea === "Interface") {
    return batch.commits.length > 1
      ? "Interface and Chat Experience Improvements"
      : toTitleCase(topSubjects[0] || "Interface improvements");
  }
  if (topArea === "Core Rust") {
    return batch.commits.length > 1
      ? "Core Runtime Improvements"
      : toTitleCase(topSubjects[0] || "Core runtime improvements");
  }
  if (topArea === "Docs") {
    return "Documentation Improvements";
  }
  if (topSubjects.length === 0) {
    return `${topArea} updates`;
  }
  if (topSubjects.length === 1) {
    return toTitleCase(topSubjects[0]);
  }
  return `${toTitleCase(topSubjects[0])} and ${toTitleCase(topSubjects[1])}`;
}

function buildBatchSummary(batch) {
  const topArea = batch.area_summary[0]?.area || "Product";
  const secondArea = batch.area_summary[1]?.area || "";
  const subjectCount = unique(batch.commits.map((commit) => commit.cleanSubject)).length;

  if (topArea === "Release Infrastructure") {
    return `${subjectCount} related release, CI, signing, or packaging fixes were consolidated into one broader reliability update.`;
  }
  if (topArea === "Interface" && secondArea === "Core Rust") {
    return `${subjectCount} related interface and runtime changes landed together to smooth tool flows, chat behavior, and day-to-day product interactions.`;
  }
  if (topArea === "Interface") {
    return `${subjectCount} related interface changes landed together across chat, settings, workflow, and product surfaces.`;
  }
  if (topArea === "Core Rust") {
    return `${subjectCount} related runtime and backend changes landed together to improve underlying product behavior.`;
  }
  if (topArea === "Docs") {
    return `${subjectCount} documentation updates landed together in support of the product and release flow.`;
  }

  const subjects = unique(batch.commits.map((commit) => commit.cleanSubject)).slice(0, 2);
  if (subjects.length > 1) {
    return `${subjects[0]}. ${subjects[1]}.`;
  }
  return `${subjects[0] || `${batch.commits.length} related updates shipped.`}`;
}

function buildDeterministicFallback({ dateKey, commits, repo, channel: currentChannel, currentVersion, batches, tz }) {
  const entries = batches.map((batch) => {
    const title = buildHeadlineFromBatch(batch);
    const subjects = unique(batch.commits.map((commit) => commit.cleanSubject)).slice(0, 4);
    const summary = buildBatchSummary(batch);

    return {
      time_label: batch.time_label,
      started_at: batch.started_at,
      ended_at: batch.ended_at,
      title,
      summary,
      items: subjects.map((text) => {
        const sources = batch.commits.filter((commit) => commit.cleanSubject === text);
        return {
          text,
          commit_shas: sources.map((commit) => commit.sha),
          confidence: "medium",
        };
      }),
    };
  });

  const title = `${entries.length} update${entries.length === 1 ? "" : "s"} shipped`;
  const intro = `This ${currentChannel} timeline for ${repo} groups ${commits.length} notable commit${commits.length === 1 ? "" : "s"} into ${entries.length} broader update${entries.length === 1 ? "" : "s"} on ${formatDateInTimeZone(new Date(`${dateKey}T12:00:00Z`), tz)}${currentVersion ? ` for \`${currentVersion}\`` : ""}.`;
  const highlights = unique(entries.map((entry) => entry.title)).slice(0, 4);

  return {
    date: dateKey,
    repo,
    channel: currentChannel,
    version: currentVersion,
    title,
    intro,
    entries,
    highlights,
    raw_commit_count: commits.length,
  };
}

function validateRenderedEntry(candidate, commitShas) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("LLM did not return a JSON object");
  }

  const validShas = new Set(commitShas);
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    throw new Error("title must be a non-empty string");
  }
  if (typeof candidate.intro !== "string" || !candidate.intro.trim()) {
    throw new Error("intro must be a non-empty string");
  }
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) {
    throw new Error("entries must be a non-empty array");
  }

  const entries = candidate.entries.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("entry must be an object");
    }
    if (typeof entry.title !== "string" || !entry.title.trim()) {
      throw new Error("entry.title must be a non-empty string");
    }
    if (typeof entry.summary !== "string" || !entry.summary.trim()) {
      throw new Error("entry.summary must be a non-empty string");
    }
    if (!Array.isArray(entry.items) || entry.items.length === 0) {
      throw new Error("entry.items must be a non-empty array");
    }
    if (typeof entry.time_label !== "string" || !entry.time_label.trim()) {
      throw new Error("entry.time_label must be a non-empty string");
    }
    if (typeof entry.started_at !== "string" || !entry.started_at.trim()) {
      throw new Error("entry.started_at must be a non-empty string");
    }

    return {
      time_label: entry.time_label.trim(),
      started_at: entry.started_at.trim(),
      ended_at: entry.ended_at ? String(entry.ended_at).trim() : entry.started_at.trim(),
      title: entry.title.trim(),
      summary: entry.summary.trim(),
      items: entry.items.map((item) => {
        if (!item || typeof item !== "object") {
          throw new Error("entry item must be an object");
        }
        if (typeof item.text !== "string" || !item.text.trim()) {
          throw new Error("entry item text must be a non-empty string");
        }
        const shas = Array.isArray(item.commit_shas)
          ? item.commit_shas.map((sha) => String(sha)).filter((sha) => validShas.has(sha))
          : [];
        return {
          text: item.text.trim(),
          commit_shas: shas,
          confidence: item.confidence === "high" ? "high" : "medium",
        };
      }).filter((item) => item.text),
    };
  }).filter((entry) => entry.items.length > 0);

  if (entries.length === 0) {
    throw new Error("No valid entries returned");
  }

  return {
    date: String(candidate.date || ""),
    repo: String(candidate.repo || ""),
    channel: String(candidate.channel || ""),
    version: candidate.version ? String(candidate.version) : null,
    title: candidate.title.trim(),
    intro: candidate.intro.trim(),
    entries,
    highlights: Array.isArray(candidate.highlights)
      ? candidate.highlights.map((value) => String(value).trim()).filter(Boolean).slice(0, 5)
      : [],
    raw_commit_count: Number(candidate.raw_commit_count) || commitShas.length,
  };
}

async function generateWithAnthropic(bundle) {
  const systemPrompt = [
    "You are writing a polished daily product changelog timeline for Aura.",
    "Aim for a day page with multiple time-stamped headline entries rather than one giant headline.",
    "Use the release metadata, batched commit history, file-level context, and selected diff excerpts to produce user-facing timeline entries.",
    "Write like a product editor, not like a git log summarizer.",
    "Focus on meaningful product, developer-experience, release, reliability, and platform changes.",
    "Prefer concrete user-visible or operator-visible outcomes over implementation details.",
    "Each timeline entry should correspond to one batched theme and time window.",
    "Do not merge work that is far apart in time just because it shares a topic.",
    "Use commit messages and diffs together; do not rely on commit titles alone.",
    "Merge related commits inside a batch into stronger outcome-oriented bullets.",
    "It is good for one bullet to cite multiple commit SHAs when the work spans several commits.",
    "Do not mirror one commit per bullet unless the change is truly distinct and important.",
    "Do not reuse commit-title phrasing when a clearer outcome-oriented sentence is possible.",
    "Ignore merge commits, formatting-only changes, and low-signal maintenance unless they materially changed release quality, reliability, or user experience.",
    "Ignore pure merge commits like 'Merge branch main', routine lockfile churn, and tiny housekeeping-only commits.",
    "Do not call out tests, refactors, or cleanup on their own unless they directly improved a shipped behavior or release confidence in a meaningful way.",
    "If several commits are all part of the same CI, runner, cache, signing, or release-debugging thread, summarize them as one broader reliability update instead of listing each small fix.",
    "Do not invent features or claims that are not supported by the input.",
    "If evidence is weak, omit the item.",
    "If the day mostly contains infrastructure or release work, say that clearly rather than pretending it was a feature release.",
    "Return valid JSON only, with no markdown fences or extra explanation.",
  ].join(" ");

  const userPrompt = [
    "Create a daily changelog timeline for Aura from the following release bundle.",
    "",
    "Target audience:",
    "- users checking what changed today",
    "- internal team members scanning release progress",
    "",
    "Desired style:",
    "- one compact day title",
    "- one short day intro paragraph",
    "- 2 to 6 time-stamped timeline entries",
    "- each timeline entry should have a headline, short summary, and 1 to 4 concise bullets",
    "- entries should be specific and meaningful",
    "- if there are important release or reliability changes, include them as their own timeline entries",
    "- write like an editorial product changelog, not a cleaned-up commit dump",
    "- use coherent release themes, polished phrasing, and compact but meaningful entries",
    "",
    "JSON schema:",
    "{",
    '  "date": "YYYY-MM-DD",',
    '  "repo": "string",',
    '  "channel": "string",',
    '  "version": "string|null",',
    '  "title": "string",',
    '  "intro": "string",',
    '  "entries": [',
    "    {",
    '      "time_label": "string",',
    '      "started_at": "ISO-8601 string",',
    '      "ended_at": "ISO-8601 string",',
      '      "title": "string",',
    '      "summary": "string",',
      '      "items": [',
    "        {",
    '          "text": "string",',
    '          "commit_shas": ["string"],',
    '          "confidence": "high|medium"',
    "        }",
    "      ]",
    "    }",
    "  ],",
    '  "highlights": ["string"],',
    '  "raw_commit_count": 0',
    "}",
    "",
    "Important constraints:",
    "- Every bullet must be traceable to one or more commit SHAs.",
    "- Do not mention any bullet unless there is evidence in commits or diffs.",
    "- Prefer fewer, stronger bullets over many weak ones.",
    "- A bullet may cite multiple commit SHAs when several commits combine into one shipped outcome.",
    "- Prefer summarizing the combined effect of related work over listing commit-by-commit changes.",
    "- Keep each timeline entry faithful to its provided batch and time window.",
    "- Do not merge two distant batches into one headline just because they share a topic.",
    "- Do not repeat raw commit titles or conventional-commit phrasing unless the exact wording is genuinely the clearest option.",
    "- Exclude merge commits and low-signal maintenance unless they materially affected shipping, reliability, or user experience.",
    "- Skip pure merge messages like 'Merge branch main' entirely.",
    "- If several commits represent one release-debugging thread, compress them into one broader reliability bullet instead of enumerating each micro-fix.",
    "- Do not mention tests, formatting, or internal cleanup unless they clearly improved user-facing behavior or release confidence.",
    "- Mention platform names when relevant: Desktop, Mac, Windows, Linux, iOS, Android, Release Infrastructure, Website.",
    "",
    "Release bundle:",
    JSON.stringify(bundle, null, 2),
  ].join("\n");

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 2200,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: attempt === 1
              ? userPrompt
              : `${userPrompt}\n\nThe previous response failed validation with this error:\n${lastError}\n\nReturn corrected JSON only.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${body}`);
    }

    const json = await response.json();
    const text = Array.isArray(json.content)
      ? json.content
          .filter((item) => item?.type === "text")
          .map((item) => item.text)
          .join("\n")
      : "";

    try {
      const cleaned = text
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "");
      return JSON.parse(cleaned);
    } catch (error) {
      lastError = `Could not parse model response as JSON: ${error}`;
    }
  }

  throw new Error(lastError || "Anthropic response could not be parsed");
}

function renderMarkdown(doc) {
  const lines = [
    `# ${doc.rendered.title}`,
    "",
    `- Date: \`${doc.date}\``,
    `- Channel: \`${doc.channel}\``,
  ];

  if (doc.version) {
    lines.push(`- Version: \`${doc.version}\``);
  }
  if (doc.releaseUrl) {
    lines.push(`- Release: ${doc.releaseUrl}`);
  }

  lines.push("", doc.rendered.intro, "");

  for (const entry of doc.rendered.entries) {
    lines.push(`## ${entry.time_label} — ${entry.title}`, "");
    lines.push(entry.summary, "");
    for (const item of entry.items) {
      const suffix = item.commit_shas.length ? ` (${item.commit_shas.map((sha) => `\`${sha.slice(0, 7)}\``).join(", ")})` : "";
      lines.push(`- ${item.text}${suffix}`);
    }
    lines.push("");
  }

  if (doc.rendered.highlights.length) {
    lines.push("## Highlights", "");
    for (const highlight of doc.rendered.highlights) {
      lines.push(`- ${highlight}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function computeBootstrapCommits(currentSha) {
  return runGit(["rev-list", "--reverse", "-n", "20", currentSha])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const now = new Date();
const dateKey = formatDateInTimeZone(now, timeZone);
const currentSha = sanitizeText(args["current-sha"] || runGit(["rev-parse", "HEAD"]));

const channelDir = path.join(pagesDir, "changelog", channel);
const historyDir = path.join(channelDir, "history");
const latestPath = path.join(channelDir, "latest.json");
const latestMdPath = path.join(channelDir, "latest.md");
const todayJsonPath = path.join(historyDir, `${dateKey}.json`);
const todayMdPath = path.join(historyDir, `${dateKey}.md`);
const existingToday = readJsonIfExists(todayJsonPath);
const latestExisting = readJsonIfExists(latestPath);
const previousSha = sanitizeText(latestExisting?.lastIncludedSha || "");

let newCommitShas = [];
if (previousSha && previousSha !== currentSha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", previousSha, currentSha], {
      cwd: repoDir,
      stdio: "ignore",
    });
    newCommitShas = runGit(["rev-list", "--reverse", `${previousSha}..${currentSha}`])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    newCommitShas = computeBootstrapCommits(currentSha);
  }
} else if (!previousSha) {
  newCommitShas = computeBootstrapCommits(currentSha);
}

const existingCommits = Array.isArray(existingToday?.rawCommits) ? existingToday.rawCommits : [];
const existingShas = new Set(existingCommits.map((commit) => commit.sha));
const uniqueNewShas = newCommitShas.filter((sha) => !existingShas.has(sha));
const appendedCommits = uniqueNewShas.map(collectCommit);
const allCommits = [...existingCommits, ...appendedCommits];
const filteredCommits = allCommits.filter((commit) => !shouldIgnoreCommitForRendering(commit));
const renderableCommits = filteredCommits.length > 0 ? filteredCommits : allCommits;

if (allCommits.length === 0) {
  console.error("No commits available to generate changelog entry");
  process.exit(1);
}

const allCommitShas = renderableCommits.map((commit) => commit.sha);
const sortedAreas = summarizeAreas(renderableCommits);
const timeBatches = batchCommits(renderableCommits, timeZone);
const selectedCommitExcerpts = [...renderableCommits]
  .sort((a, b) => scoreCommit(b) - scoreCommit(a))
  .slice(0, 8)
  .map((commit) => ({
    sha: commit.sha,
    subject: commit.subject,
    primaryArea: commit.primaryArea,
    excerpt: collectPatchExcerpt(commit.sha),
  }));

const aggregateStats = renderableCommits.reduce((acc, commit) => {
  acc.insertions += commit.stats.insertions;
  acc.deletions += commit.stats.deletions;
  acc.files += commit.stats.fileCount;
  return acc;
}, { insertions: 0, deletions: 0, files: 0 });

const artifactSummaries = collectArtifactSummaries(artifactsDir);
const bundle = {
  prompt_version: promptVersion,
  repo: repoName,
  channel,
  version,
  date: dateKey,
  release_url: releaseUrl || null,
  current_sha: currentSha,
  previous_processed_sha: previousSha || null,
  new_commit_count: uniqueNewShas.length,
  total_daily_commit_count: renderableCommits.length,
  raw_daily_commit_count: allCommits.length,
  aggregate_stats: aggregateStats,
  top_areas: sortedAreas,
  batches: timeBatches.map((batch) => ({
    id: batch.id,
    time_label: batch.time_label,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    commit_count: batch.commits.length,
    top_areas: batch.area_summary,
    commits: batch.commits.map((commit) => ({
      sha: commit.sha,
      committed_at: commit.committedAt,
      subject: commit.subject,
      body: commit.body,
      primary_area: commit.primaryArea,
      areas: commit.areas,
      files: commit.files.slice(0, 20),
      stats: commit.stats,
    })),
  })),
  selected_patch_excerpts: selectedCommitExcerpts,
  release_artifacts: artifactSummaries,
};

let rendered;
let generator = "fallback";
let generationError = null;

if (anthropicApiKey) {
  try {
    const candidate = await generateWithAnthropic(bundle);
    rendered = validateRenderedEntry(candidate, allCommitShas);
    generator = "anthropic";
  } catch (error) {
    generationError = String(error);
  }
}

if (!rendered) {
  rendered = buildDeterministicFallback({
    dateKey,
    commits: renderableCommits,
    repo: repoName,
    channel,
    currentVersion: version,
    batches: timeBatches,
    tz: timeZone,
  });
}

const doc = {
  schemaVersion: 1,
  promptVersion,
  generator,
  generationError,
  generatedAt: now.toISOString(),
  repo: repoName,
  channel,
  version,
  date: dateKey,
  releaseUrl: releaseUrl || null,
  lastIncludedSha: currentSha,
  previousProcessedSha: previousSha || null,
  commitShas: allCommitShas,
  rawCommitCount: allCommits.length,
  filteredCommitCount: renderableCommits.length,
  rawCommits: allCommits,
  batchCount: timeBatches.length,
  artifactSummaries,
  rendered,
};

writeJson(todayJsonPath, doc);
writeJson(latestPath, doc);

const markdown = renderMarkdown(doc);
fs.mkdirSync(path.dirname(todayMdPath), { recursive: true });
fs.writeFileSync(todayMdPath, markdown);
fs.writeFileSync(latestMdPath, markdown);

const indexEntries = fs.readdirSync(historyDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .reverse()
  .map((name) => {
    const filePath = path.join(historyDir, name);
    const entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      date: entry.date,
      channel: entry.channel,
      version: entry.version,
      title: entry.rendered?.title || "",
      intro: entry.rendered?.intro || "",
      entryCount: Array.isArray(entry.rendered?.entries) ? entry.rendered.entries.length : 0,
      highlights: Array.isArray(entry.rendered?.highlights) ? entry.rendered.highlights : [],
      rawCommitCount: entry.rawCommitCount || 0,
      generatedAt: entry.generatedAt,
      releaseUrl: entry.releaseUrl || null,
      path: `history/${name}`,
    };
  });
writeJson(path.join(channelDir, "index.json"), indexEntries);

console.log(JSON.stringify({
  date: dateKey,
  channel,
  version,
  generatedAt: doc.generatedAt,
  generator,
  generationError,
  rawCommitCount: doc.rawCommitCount,
  lastIncludedSha: doc.lastIncludedSha,
  files: {
    latestJson: path.relative(pagesDir, latestPath),
    latestMd: path.relative(pagesDir, latestMdPath),
    historyJson: path.relative(pagesDir, todayJsonPath),
    historyMd: path.relative(pagesDir, todayMdPath),
    indexJson: path.relative(pagesDir, path.join(channelDir, "index.json")),
  },
}, null, 2));
