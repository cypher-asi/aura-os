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
const timeZone = String(args.timezone || process.env.CHANGELOG_TIMEZONE || "America/New_York");
const repoName = String(args.repo || path.basename(repoDir));
const promptVersion = 1;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
const anthropicModel = process.env.CHANGELOG_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

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

function buildDeterministicFallback({ dateKey, commits, repo, channel: currentChannel, currentVersion }) {
  const grouped = new Map();
  for (const commit of commits) {
    const key = commit.primaryArea;
    grouped.set(key, [...(grouped.get(key) || []), commit]);
  }

  const orderedGroups = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 4);

  const sections = orderedGroups.map(([title, group]) => ({
    title,
    items: unique(group.map((commit) => cleanSubject(commit.subject)))
      .slice(0, 5)
      .map((text) => {
        const source = group.find((commit) => cleanSubject(commit.subject) === text);
        return {
          text,
          commit_shas: source ? [source.sha] : [],
          confidence: "medium",
        };
      }),
  })).filter((section) => section.items.length > 0);

  const topAreas = orderedGroups.map(([title]) => title);
  const title = topAreas.length > 1
    ? `${topAreas[0]} and ${topAreas[1]} updates`
    : `${topAreas[0] || "Daily"} updates`;
  const intro = `This ${currentChannel} update for ${repo} bundles ${commits.length} landed commit${commits.length === 1 ? "" : "s"} into one daily changelog entry${currentVersion ? ` for \`${currentVersion}\`` : ""}.`;
  const highlights = sections.flatMap((section) => section.items.map((item) => item.text)).slice(0, 3);

  return {
    date: dateKey,
    repo,
    channel: currentChannel,
    version: currentVersion,
    title,
    intro,
    sections,
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
  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    throw new Error("sections must be a non-empty array");
  }

  const sections = candidate.sections.map((section) => {
    if (!section || typeof section !== "object") {
      throw new Error("section must be an object");
    }
    if (typeof section.title !== "string" || !section.title.trim()) {
      throw new Error("section.title must be a non-empty string");
    }
    if (!Array.isArray(section.items) || section.items.length === 0) {
      throw new Error("section.items must be a non-empty array");
    }

    return {
      title: section.title.trim(),
      items: section.items.map((item) => {
        if (!item || typeof item !== "object") {
          throw new Error("section item must be an object");
        }
        if (typeof item.text !== "string" || !item.text.trim()) {
          throw new Error("section item text must be a non-empty string");
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
  }).filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    throw new Error("No valid sections returned");
  }

  return {
    date: String(candidate.date || ""),
    repo: String(candidate.repo || ""),
    channel: String(candidate.channel || ""),
    version: candidate.version ? String(candidate.version) : null,
    title: candidate.title.trim(),
    intro: candidate.intro.trim(),
    sections,
    highlights: Array.isArray(candidate.highlights)
      ? candidate.highlights.map((value) => String(value).trim()).filter(Boolean).slice(0, 5)
      : [],
    raw_commit_count: Number(candidate.raw_commit_count) || commitShas.length,
  };
}

async function generateWithAnthropic(bundle) {
  const systemPrompt = [
    "You are writing a polished daily product changelog entry for Aura, similar in spirit to a company changelog page like Cursor's.",
    "Use the release metadata, commit history, file-level context, and selected diff excerpts to produce a user-facing changelog entry.",
    "Focus on meaningful product, developer-experience, release, reliability, and platform changes.",
    "Prefer concrete user-visible or operator-visible outcomes over implementation details.",
    "Use commit messages and diffs together; do not rely on commit titles alone.",
    "Do not invent features or claims that are not supported by the input.",
    "If evidence is weak, omit the item.",
    "If the day mostly contains infrastructure or release work, say that clearly rather than pretending it was a feature release.",
    "Return valid JSON only, with no markdown fences or extra explanation.",
  ].join(" ");

  const userPrompt = [
    "Create a daily changelog entry for Aura from the following release bundle.",
    "",
    "Target audience:",
    "- users checking what changed today",
    "- internal team members scanning release progress",
    "",
    "Desired style:",
    "- one strong title",
    "- one short intro paragraph",
    "- 2 to 5 sections",
    "- each section should contain 2 to 6 concise bullets",
    "- bullets should be specific and meaningful",
    "- if there are important release or reliability changes, include them",
    "",
    "JSON schema:",
    "{",
    '  "date": "YYYY-MM-DD",',
    '  "repo": "string",',
    '  "channel": "string",',
    '  "version": "string|null",',
    '  "title": "string",',
    '  "intro": "string",',
    '  "sections": [',
    "    {",
    '      "title": "string",',
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

  for (const section of doc.rendered.sections) {
    lines.push(`## ${section.title}`, "");
    for (const item of section.items) {
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

if (allCommits.length === 0) {
  console.error("No commits available to generate changelog entry");
  process.exit(1);
}

const allCommitShas = allCommits.map((commit) => commit.sha);
const sortedAreas = summarizeAreas(allCommits);
const selectedCommitExcerpts = [...allCommits]
  .sort((a, b) => scoreCommit(b) - scoreCommit(a))
  .slice(0, 8)
  .map((commit) => ({
    sha: commit.sha,
    subject: commit.subject,
    primaryArea: commit.primaryArea,
    excerpt: collectPatchExcerpt(commit.sha),
  }));

const aggregateStats = allCommits.reduce((acc, commit) => {
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
  total_daily_commit_count: allCommits.length,
  aggregate_stats: aggregateStats,
  top_areas: sortedAreas,
  commits: allCommits.map((commit) => ({
    sha: commit.sha,
    committed_at: commit.committedAt,
    subject: commit.subject,
    body: commit.body,
    primary_area: commit.primaryArea,
    areas: commit.areas,
    files: commit.files.slice(0, 20),
    stats: commit.stats,
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
    commits: allCommits,
    repo: repoName,
    channel,
    currentVersion: version,
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
  rawCommits: allCommits,
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
