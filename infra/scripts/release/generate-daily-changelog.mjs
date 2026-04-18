#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const promptVersion = 3;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
const anthropicModel = process.env.CHANGELOG_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
const anthropicMaxTokens = Number.parseInt(process.env.CHANGELOG_ANTHROPIC_MAX_TOKENS || "", 10) || 4096;
const anthropicRetryMaxTokens = Number.parseInt(process.env.CHANGELOG_ANTHROPIC_RETRY_MAX_TOKENS || "", 10) || 6144;
const STRICT_TOOL_SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-opus-4-1",
];
const BATCH_WINDOW_MINUTES = 120;
const SOFT_BATCH_WINDOW_MINUTES = 45;
const MAX_BATCH_SPAN_MINUTES = 180;
const MAX_BATCH_COMMITS = 8;
const TARGET_MAX_BATCHES = 6;

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

function buildChangelogTool(batchIds) {
  const defaultBatchId = batchIds[0] || "entry-1";

  return {
    name: "submit_daily_changelog",
    description: [
      "Submit the final structured daily changelog narrative for Aura.",
      "Use this exactly once for the final answer after reviewing all provided release batches, commit summaries, and diff excerpts.",
      "Only return fields defined by the schema. Do not include date, channel, version, timestamps, or counts because those are computed by the caller.",
      "Each entry must map to one provided batch_id and stay faithful to that batch's time window and evidence.",
      "Use 2 to 6 entries total, omit only truly low-signal batches, and keep every bullet directly supported by the listed commits or excerpts.",
      "Each item's commit_shas must only reference commits from the same batch_id.",
    ].join(" "),
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        day_title: {
          type: "string",
          description: "A compact day-level headline for the release.",
        },
        day_intro: {
          type: "string",
          description: "A short introductory paragraph for the day.",
        },
        highlights: {
          type: "array",
          description: "Short highlight pills summarizing the strongest takeaways.",
          items: {
            type: "string",
          },
        },
        entries: {
          type: "array",
          description: "A curated set of timeline entries mapped to provided batch IDs.",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              batch_id: {
                type: "string",
                enum: batchIds,
                description: "The exact batch id being summarized.",
              },
              title: {
                type: "string",
                description: "A concise title for this timeline entry.",
              },
              summary: {
                type: "string",
                description: "A short summary sentence for the entry.",
              },
              items: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: {
                      type: "string",
                      description: "A concise, evidence-backed bullet.",
                    },
                    commit_shas: {
                      type: "array",
                      description: "Commit SHAs from the same batch that support this bullet.",
                      minItems: 1,
                      items: {
                        type: "string",
                      },
                    },
                    confidence: {
                      type: "string",
                      enum: ["high", "medium"],
                    },
                  },
                  required: ["text", "commit_shas", "confidence"],
                },
              },
            },
            required: ["batch_id", "title", "summary", "items"],
          },
        },
      },
      required: ["day_title", "day_intro", "highlights", "entries"],
    },
    input_examples: [
      {
        day_title: "Interface reliability and release tooling improvements",
        day_intro: "This release focused on higher-confidence product polish and release workflow stability across the day.",
        highlights: [
          "Improved chat and workflow reliability",
          "Release tooling got more resilient",
        ],
        entries: [
          {
            batch_id: defaultBatchId,
            title: "Workflow reliability improvements",
            summary: "Related changes tightened workflow behavior and reduced regressions.",
            items: [
              {
                text: "Improved workflow behavior with a tighter end-to-end update.",
                commit_shas: ["example-sha-1"],
                confidence: "medium",
              },
            ],
          },
        ],
      },
    ],
  };
}

function findToolUseInput(responseJson, toolName) {
  const content = Array.isArray(responseJson?.content) ? responseJson.content : [];
  const block = content.find((item) => item?.type === "tool_use" && item?.name === toolName);
  return block?.input;
}

function assertStrictToolModelSupport(model) {
  if (STRICT_TOOL_SUPPORTED_MODELS.includes(model)) {
    return;
  }
  throw new Error(
    `Model ${model} is not in the strict-tool allowlist (${STRICT_TOOL_SUPPORTED_MODELS.join(", ")})`,
  );
}

function wordCount(value) {
  return sanitizeText(value).split(/\s+/).filter(Boolean).length;
}

function normalizeForComparison(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function collectRubricIssues(rendered, batches) {
  const issues = [];
  const normalizedDayTitle = normalizeForComparison(rendered.title);
  const normalizedIntro = normalizeForComparison(rendered.intro);

  if (wordCount(rendered.title) < 3 || wordCount(rendered.title) > 14) {
    issues.push("day title must be between 3 and 14 words");
  }
  if (/\bupdates?\s+shipped\b/i.test(rendered.title) || /\brelease notes?\b/i.test(rendered.title)) {
    issues.push("day title is too generic");
  }
  if (wordCount(rendered.intro) < 12) {
    issues.push("day intro is too short");
  }
  if (
    normalizedIntro.includes("groups") &&
    normalizedIntro.includes("commits") &&
    normalizedIntro.includes("updates")
  ) {
    issues.push("day intro reads like a generated count summary instead of an editorial intro");
  }

  const normalizedHighlights = rendered.highlights.map(normalizeForComparison).filter(Boolean);
  if (new Set(normalizedHighlights).size !== normalizedHighlights.length) {
    issues.push("highlights must be unique");
  }

  const titleCounts = new Map();
  const itemTexts = new Set();
  for (const entry of rendered.entries) {
    const normalizedEntryTitle = normalizeForComparison(entry.title);
    titleCounts.set(normalizedEntryTitle, (titleCounts.get(normalizedEntryTitle) || 0) + 1);

    if (wordCount(entry.title) < 2 || wordCount(entry.title) > 10) {
      issues.push(`entry title "${entry.title}" must be between 2 and 10 words`);
    }
    if (/^\d+\s+related\b/i.test(entry.summary) || /\blanded together\b/i.test(entry.summary)) {
      issues.push(`entry summary "${entry.summary}" is too templated`);
    }
    if (wordCount(entry.summary) < 8) {
      issues.push(`entry summary "${entry.summary}" is too short`);
    }

    for (const item of entry.items) {
      const normalizedItemText = normalizeForComparison(item.text);
      if (wordCount(item.text) < 6) {
        issues.push(`item "${item.text}" is too short`);
      }
      if (itemTexts.has(normalizedItemText)) {
        issues.push(`duplicate bullet text detected: "${item.text}"`);
      }
      itemTexts.add(normalizedItemText);
    }
  }

  for (const [title, count] of titleCounts.entries()) {
    if (title && count > 1) {
      issues.push(`entry title "${title}" is reused ${count} times`);
    }
  }

  if (issues.length === 0 && normalizedDayTitle === normalizeForComparison(batches[0]?.id || "")) {
    issues.push("day title does not look editorial");
  }

  return unique(issues);
}

function validateRenderedEntry(candidate, batches, totalCommitCount) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("LLM did not return a tool input object");
  }
  if (typeof candidate.day_title !== "string" || !candidate.day_title.trim()) {
    throw new Error("day_title must be a non-empty string");
  }
  if (typeof candidate.day_intro !== "string" || !candidate.day_intro.trim()) {
    throw new Error("day_intro must be a non-empty string");
  }
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) {
    throw new Error("entries must be a non-empty array");
  }

  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  const seenBatchIds = new Set();
  const entries = candidate.entries.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("entry must be an object");
    }
    if (typeof entry.batch_id !== "string" || !batchMap.has(entry.batch_id)) {
      throw new Error(`entry.batch_id must reference a known batch (${entry?.batch_id || "missing"})`);
    }
    if (seenBatchIds.has(entry.batch_id)) {
      throw new Error(`entry.batch_id must be unique (${entry.batch_id})`);
    }
    seenBatchIds.add(entry.batch_id);

    const batch = batchMap.get(entry.batch_id);
    const validShas = new Set(batch.commits.map((commit) => commit.sha));

    if (typeof entry.title !== "string" || !entry.title.trim()) {
      throw new Error("entry.title must be a non-empty string");
    }
    if (typeof entry.summary !== "string" || !entry.summary.trim()) {
      throw new Error("entry.summary must be a non-empty string");
    }
    if (!Array.isArray(entry.items) || entry.items.length === 0) {
      throw new Error("entry.items must be a non-empty array");
    }

    const items = entry.items.map((item) => {
      if (!item || typeof item !== "object") {
        throw new Error("entry item must be an object");
      }
      if (typeof item.text !== "string" || !item.text.trim()) {
        throw new Error("entry item text must be a non-empty string");
      }
      const shas = Array.isArray(item.commit_shas)
        ? item.commit_shas.map((sha) => String(sha)).filter((sha) => validShas.has(sha))
        : [];
      if (shas.length === 0) {
        throw new Error(`entry item must cite at least one SHA from batch ${entry.batch_id}`);
      }
      return {
        text: item.text.trim(),
        commit_shas: unique(shas),
        confidence: item.confidence === "high" ? "high" : "medium",
      };
    }).filter((item) => item.text);

    if (items.length === 0) {
      throw new Error(`entry ${entry.batch_id} did not contain any valid items`);
    }

    return {
      time_label: batch.time_label,
      started_at: batch.started_at,
      ended_at: batch.ended_at,
      title: entry.title.trim(),
      summary: entry.summary.trim(),
      items,
    };
  });

  const rendered = {
    title: candidate.day_title.trim(),
    intro: candidate.day_intro.trim(),
    entries,
    highlights: Array.isArray(candidate.highlights)
      ? candidate.highlights.map((value) => String(value).trim()).filter(Boolean)
      : [],
    raw_commit_count: totalCommitCount,
  };

  const rubricIssues = collectRubricIssues(rendered, batches);
  if (rubricIssues.length > 0) {
    throw new Error(`Changelog rubric failed: ${rubricIssues.join("; ")}`);
  }

  return rendered;
}

async function generateWithAnthropic(bundle) {
  assertStrictToolModelSupport(anthropicModel);
  const toolName = "submit_daily_changelog";
  const tool = buildChangelogTool(bundle.batches.map((batch) => batch.id));
  const systemPrompt = [
    "You are writing a polished daily product changelog timeline for Aura.",
    "Use the release metadata, batched commit history, file-level context, and selected diff excerpts to produce user-facing timeline entries.",
    "Write like a product editor, not like a git log summarizer.",
    "Focus on meaningful product, developer-experience, release, reliability, and platform changes.",
    "Prefer concrete user-visible or operator-visible outcomes over implementation details.",
    "Each timeline entry should correspond to one provided batch_id and time window.",
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
    "Never use generic filler like 'X updates shipped', 'related changes landed together', or repetitive repeated headings across multiple entries.",
    "Every accepted output must feel publication-ready, with concrete headlines, concrete summaries, and distinct entries.",
    `Call the ${toolName} tool exactly once with the final structured changelog.`,
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
    "- 2 to 6 timeline entries selected from the provided batches",
    "- each timeline entry should map to exactly one provided batch_id and have a headline, short summary, and 1 to 4 concise bullets",
    "- entries should be specific and meaningful",
    "- if there are important release or reliability changes, include them as their own timeline entries",
    "- write like an editorial product changelog, not a cleaned-up commit dump",
    "- use coherent release themes, polished phrasing, and compact but meaningful entries",
    "",
    "Important constraints:",
    "- Every bullet must be traceable to one or more commit SHAs.",
    "- Do not mention any bullet unless there is evidence in commits or diffs.",
    "- Prefer fewer, stronger bullets over many weak ones.",
    "- A bullet may cite multiple commit SHAs when several commits combine into one shipped outcome.",
    "- Prefer summarizing the combined effect of related work over listing commit-by-commit changes.",
    "- Keep each timeline entry faithful to its provided batch_id and time window.",
    "- Do not merge two distinct batch_ids into one entry.",
    "- Do not repeat raw commit titles or conventional-commit phrasing unless the exact wording is genuinely the clearest option.",
    "- Exclude merge commits and low-signal maintenance unless they materially affected shipping, reliability, or user experience.",
    "- Skip pure merge messages like 'Merge branch main' entirely.",
    "- If several commits represent one release-debugging thread, compress them into one broader reliability bullet instead of enumerating each micro-fix.",
    "- Do not mention tests, formatting, or internal cleanup unless they clearly improved user-facing behavior or release confidence.",
    "- Mention platform names when relevant: Desktop, Mac, Windows, Linux, iOS, Android, Release Infrastructure, Website.",
    "- Use distinct entry titles. Do not repeat the same headline for multiple timeline entries.",
    "- Write editorial summaries, not counting summaries like '8 related changes landed together'.",
    "- The day title must be publication-ready and not generic.",
    `- Return the final answer by calling the ${toolName} tool, not as freeform text.`,
    "",
    "Release bundle:",
    JSON.stringify(bundle, null, 2),
  ].join("\n");

  let lastError = null;

  const maxTokensByAttempt = [anthropicMaxTokens, anthropicRetryMaxTokens];

  for (let attempt = 1; attempt <= maxTokensByAttempt.length; attempt += 1) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: maxTokensByAttempt[attempt - 1],
        temperature: 0.2,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: "any" },
        messages: [
          {
            role: "user",
            content: attempt === 1
              ? userPrompt
              : `${userPrompt}\n\nThe previous response failed validation with this error:\n${lastError}\n\nCall the tool again with corrected input. Keep it compact, with at most 6 timeline entries.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${body}`);
    }

    const json = await response.json();
    try {
      const input = findToolUseInput(json, toolName);
      if (!input) {
        throw new Error(`Model did not return a ${toolName} tool call`);
      }
      return input;
    } catch (error) {
      const stopReason = json?.stop_reason ? ` (stop_reason=${json.stop_reason})` : "";
      lastError = `Could not validate model tool output${stopReason}: ${error}`;
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

async function main() {
  if (!fs.existsSync(repoDir)) {
    console.error(`repo directory not found: ${repoDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(pagesDir)) {
    console.error(`pages directory not found: ${pagesDir}`);
    process.exit(1);
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
  const generator = "anthropic";
  let generationError = null;

  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is required for changelog generation");
    process.exit(1);
  }

  try {
    const candidate = await generateWithAnthropic(bundle);
    rendered = validateRenderedEntry(candidate, timeBatches, renderableCommits.length);
  } catch (error) {
    generationError = String(error);
    console.error(JSON.stringify({
      error: "changelog_generation_failed",
      date: dateKey,
      channel,
      version,
      currentSha,
      batchCount: timeBatches.length,
      filteredCommitCount: renderableCommits.length,
      generationError,
    }, null, 2));
    process.exit(1);
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
}

export {
  assertStrictToolModelSupport,
  batchCommits,
  collectRubricIssues,
  normalizeForComparison,
  validateRenderedEntry,
  wordCount,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
