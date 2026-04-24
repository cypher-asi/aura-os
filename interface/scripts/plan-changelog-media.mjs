#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAuraNavigationSitemap } from "./lib/aura-navigation-contract.mjs";
import {
  buildMediaPlannerPrompt,
  extractChangelogMediaEntries,
  planChangelogMediaWithAnthropic,
} from "./lib/changelog-media-planner.mjs";
import { resolveDemoRepoPath } from "./lib/demo-repo-paths.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) index += 1;
    if (key in args) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  }
  return args;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry || "").split(",")).map((entry) => entry.trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function readTextMaybe(filePath) {
  if (!filePath) return "";
  return fs.readFileSync(resolveInputPath(filePath), "utf8").trim();
}

function readChangedFiles(args) {
  const inline = normalizeArray(args["changed-file"]);
  const body = readTextMaybe(args["changed-files-file"]);
  return [...new Set([...inline, ...body.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean)])];
}

function deriveChangedFilesFromChangelog(changelog) {
  return [...new Set(
    (Array.isArray(changelog?.rawCommits) ? changelog.rawCommits : [])
      .flatMap((commit) => commit?.files || [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  )];
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  const args = parseArgs(argv);
  const changelogFile = args["changelog-file"] ? resolveInputPath(args["changelog-file"]) : null;
  if (!changelogFile) {
    throw new Error("Pass --changelog-file with the generated changelog JSON.");
  }

  const outputDir = path.resolve(args["output-dir"] || path.join(process.cwd(), "output", "changelog-media-plan"));
  const changelog = JSON.parse(fs.readFileSync(changelogFile, "utf8"));
  const changelogEntries = extractChangelogMediaEntries(changelog);
  const sitemap = await buildAuraNavigationSitemap();
  const changedFiles = [...new Set([
    ...readChangedFiles(args),
    ...deriveChangedFilesFromChangelog(changelog),
  ])];
  const commitLog = [
    String(args["commit-log"] || "").trim(),
    readTextMaybe(args["commit-log-file"]),
    deriveCommitLogFromChangelog(changelog),
  ].filter(Boolean).join("\n\n");
  const maxCandidates = Number.parseInt(String(args["max-candidates"] || process.env.CHANGELOG_MEDIA_MAX_CANDIDATES || "3"), 10) || 3;
  const model = String(
    args.model
      || process.env.CHANGELOG_MEDIA_ANTHROPIC_MODEL
      || process.env.CHANGELOG_ANTHROPIC_MODEL
      || "claude-opus-4-7",
  ).trim();

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "aura-navigation-sitemap.json"), sitemap);

  if (isEnabled(args["dry-run"])) {
    const prompt = buildMediaPlannerPrompt({
      changelogEntries,
      sitemap,
      commitLog,
      changedFiles,
      maxCandidates,
    });
    fs.writeFileSync(path.join(outputDir, "anthropic-media-planner-prompt.md"), `${prompt}\n`, "utf8");
    const summary = {
      ok: true,
      dryRun: true,
      model,
      changelogFile,
      entryCount: changelogEntries.length,
      changedFileCount: changedFiles.length,
      sitemapAppCount: sitemap.coverage.appCount,
      sitemapGapCount: sitemap.coverage.appGaps.length,
      outputDir,
    };
    writeJson(path.join(outputDir, "media-plan-summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const result = await planChangelogMediaWithAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
    model,
    changelogEntries,
    sitemap,
    commitLog,
    changedFiles,
    maxCandidates,
  });
  fs.writeFileSync(path.join(outputDir, "anthropic-media-planner-prompt.md"), `${result.prompt}\n`, "utf8");
  writeJson(path.join(outputDir, "media-plan.raw.json"), result.rawPlan);
  writeJson(path.join(outputDir, "media-plan.json"), result.plan);
  writeJson(path.join(outputDir, "media-plan-coverage.json"), result.coverage);
  writeJson(path.join(outputDir, "media-plan-attempts.json"), result.attempts.map((attempt) => ({
    attempt: attempt.attempt,
    coverage: attempt.coverage,
  })));
  const summary = {
    ok: true,
    model,
    candidateCount: result.plan.candidates.length,
    skippedCount: result.plan.skipped.length,
    coverage: result.coverage,
    attemptCount: result.attempts.length,
    outputDir,
  };
  writeJson(path.join(outputDir, "media-plan-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
