import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function collectSuspectChanges({
  check,
  feature,
  previousChecks = [],
  candidatePaths = [],
  rankedPaths = [],
  sourceNeedles = [],
  repoRoot,
}) {
  const paths = [...new Set(candidatePaths.filter(Boolean))].slice(0, 10);
  if (paths.length === 0) return [];

  const commitByHash = new Map();
  for (const hintPath of paths) {
    for (const commit of await gitLogForPath(repoRoot, hintPath)) {
      if (!commitByHash.has(commit.commit)) commitByHash.set(commit.commit, commit);
    }
    if (commitByHash.size >= 32) break;
  }

  const needles = suspectNeedles({
    check,
    feature,
    sourceNeedles,
  });
  const lastPassingAt = lastPassingEndedAt(check, previousChecks);
  const failingAt = normalizeTimestamp(check?.endedAt ?? check?.runGeneratedAt);
  const scored = [];
  for (const commit of commitByHash.values()) {
    const touchedPaths = await gitTouchedPaths(repoRoot, commit.commit);
    const candidateTouchedPaths = touchedPaths.filter((touchedPath) => paths.includes(touchedPath));
    const rankedTouchedPaths = touchedPaths.filter((touchedPath) => rankedPaths.some((entry) => entry.path === touchedPath));
    const text = `${commit.subject}\n${touchedPaths.join("\n")}`.toLowerCase();
    const matchedNeedles = needles.filter((needle) => text.includes(needle.toLowerCase())).slice(0, 8);
    const reasons = [];
    let score = 10;

    if (candidateTouchedPaths.length > 0) {
      score += 40;
      reasons.push(`Touches candidate source path(s): ${candidateTouchedPaths.slice(0, 4).join(", ")}.`);
    }
    if (rankedTouchedPaths.length > 0) {
      score += 15;
      reasons.push(`Touches ranked evidence path(s): ${rankedTouchedPaths.slice(0, 4).join(", ")}.`);
    }
    if (matchedNeedles.length > 0) {
      score += Math.min(30, matchedNeedles.length * 8);
      reasons.push(`Commit metadata overlaps eval terms: ${matchedNeedles.slice(0, 5).join(", ")}.`);
    }
    if (isBetween(commit.committedAt, lastPassingAt, failingAt)) {
      score += 35;
      reasons.push("Changed after the last passing run and before this failing run.");
    }
    if (reasons.length === 0) reasons.push("Recent change in a file implicated by source discovery.");

    scored.push({
      commit: commit.commit,
      shortCommit: commit.shortCommit,
      committedAt: commit.committedAt,
      authorName: commit.authorName,
      subject: commit.subject,
      score,
      confidence: score >= 85 ? "high" : score >= 55 ? "medium" : "low",
      reasons,
      touchedPaths: touchedPaths.slice(0, 16),
      candidateTouchedPaths,
      matchedNeedles,
      pr: null,
    });
  }

  scored.sort((left, right) =>
    right.score - left.score
      || new Date(right.committedAt ?? 0).getTime() - new Date(left.committedAt ?? 0).getTime()
      || left.shortCommit.localeCompare(right.shortCommit),
  );
  const topChanges = scored.slice(0, 8);
  await attachPullRequestMetadata(topChanges, repoRoot);
  return topChanges;
}

async function gitLogForPath(repoRoot, hintPath) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--format=%H%x09%h%x09%ct%x09%an%x09%s", "-6", "--", hintPath],
      { cwd: repoRoot, timeout: 5_000, maxBuffer: 256_000 },
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit, shortCommit, timestamp, authorName, ...subjectParts] = line.split("\t");
        const timestampMs = Number(timestamp) * 1000;
        return {
          commit,
          shortCommit,
          committedAt: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null,
          authorName,
          subject: subjectParts.join("\t"),
        };
      })
      .filter((commit) => commit.commit && commit.shortCommit);
  } catch {
    return [];
  }
}

async function gitTouchedPaths(repoRoot, commit) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", "--format=", "--name-only", commit],
      { cwd: repoRoot, timeout: 5_000, maxBuffer: 256_000 },
    );
    return [...new Set(stdout.split("\n").map((line) => line.trim()).filter(Boolean))]
      .filter((filePath) => isSafeRelativePath(filePath))
      .slice(0, 40);
  } catch {
    return [];
  }
}

async function attachPullRequestMetadata(changes, repoRoot) {
  const repoSlug = await githubRepoSlug(repoRoot);
  if (!repoSlug) return;
  await Promise.all(changes.slice(0, 5).map(async (change) => {
    try {
      const { stdout } = await execFileAsync("gh", [
        "api",
        `repos/${repoSlug}/commits/${change.commit}/pulls`,
        "-H",
        "Accept: application/vnd.github+json",
      ], { cwd: repoRoot, timeout: 6_000, maxBuffer: 128_000 });
      const prs = safeJsonParse(stdout);
      const pr = Array.isArray(prs) ? prs[0] : null;
      if (!pr) return;
      change.pr = {
        number: pr.number ?? null,
        title: pr.title ?? null,
        url: pr.html_url ?? null,
        state: pr.state ?? null,
        mergedAt: pr.merged_at ?? null,
        author: pr.user?.login ?? null,
      };
      change.reasons.push(`Associated GitHub PR: ${change.pr.url ?? `#${change.pr.number}`}.`);
    } catch {
      // GitHub PR metadata is useful context, but local and CI runs must work without gh auth.
    }
  }));
}

async function githubRepoSlug(repoRoot) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: repoRoot, timeout: 3_000, maxBuffer: 16_000 },
    );
    const remote = stdout.trim();
    const ssh = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
    if (ssh) return ssh[1];
    const https = remote.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
    if (https) return https[1];
  } catch {
    return "";
  }
  return "";
}

function suspectNeedles({ check, feature, sourceNeedles }) {
  const needles = new Set([
    ...sourceNeedles,
    check?.checkId,
    check?.featureId,
    feature?.id,
    feature?.label,
  ]);
  return [...needles]
    .filter((needle) => typeof needle === "string" && needle.trim().length >= 3)
    .map((needle) => needle.trim())
    .slice(0, 40);
}

function lastPassingEndedAt(check, previousChecks) {
  const lastPassing = previousChecks
    .filter((candidate) => candidate.checkId === check?.checkId && candidate.status === "pass")
    .sort((left, right) => new Date(right.endedAt ?? 0).getTime() - new Date(left.endedAt ?? 0).getTime())[0];
  return normalizeTimestamp(lastPassing?.endedAt);
}

function isBetween(value, start, end) {
  if (!value || !start || !end) return false;
  const valueTime = new Date(value).getTime();
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Number.isFinite(valueTime)
    && Number.isFinite(startTime)
    && Number.isFinite(endTime)
    && valueTime > startTime
    && valueTime <= endTime;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isSafeRelativePath(filePath) {
  return Boolean(filePath)
    && !path.isAbsolute(filePath)
    && !filePath.split("/").includes("..")
    && !filePath.includes("\0")
    && !filePath.startsWith(".git/");
}
