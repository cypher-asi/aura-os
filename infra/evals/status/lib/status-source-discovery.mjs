import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { collectSuspectChanges } from "./status-change-suspects.mjs";
import { redactSensitive } from "./status-redaction.mjs";

const execFileAsync = promisify(execFile);

const COMMON_SOURCE_NEEDLES = new Set([
  "allPassed",
  "count",
  "error",
  "failed",
  "message",
  "model",
  "passed",
  "provider",
  "results",
  "status",
  "total",
]);

const SEARCH_EXCLUDES = [
  "--glob",
  "!node_modules",
  "--glob",
  "!interface/node_modules",
  "--glob",
  "!interface/dist",
  "--glob",
  "!dist",
  "--glob",
  "!target",
  "--glob",
  "!.git",
  "--glob",
  "!infra/evals/reports",
];

export async function discoverInvestigationSources({
  check,
  feature = null,
  checkConfig = null,
  expectation = null,
  previousChecks = [],
  registryPath,
  expectationsPath,
  runnerPath,
  repoRoot,
  enabled = true,
  includeContext = true,
  includeRecentChanges = true,
}) {
  if (!enabled) {
    return {
      sourceHints: [],
      sourceContext: [],
      sourceDiscovery: emptySourceDiscovery(),
    };
  }

  const sourceHints = rankAndLimitHints([
    ...await findKnownSourceAnchors({
      check,
      feature,
      checkConfig,
      expectation,
      registryPath,
      expectationsPath,
      runnerPath,
      repoRoot,
    }),
    ...await searchRepoForNeedles({
      needles: sourceNeedlesForCheck(check, expectation).slice(0, 10),
      repoRoot,
    }),
  ], 32);
  const sourceContext = includeContext ? await collectSourceContext(sourceHints, repoRoot) : [];
  const pathSummary = buildSourcePathSummary(sourceHints);
  const recentChanges = includeRecentChanges ? await collectRecentChanges(sourceHints, repoRoot) : [];
  const suspectChanges = includeRecentChanges
    ? await collectSuspectChanges({
      check,
      feature,
      previousChecks,
      candidatePaths: suspectCandidatePaths(sourceHints, pathSummary),
      rankedPaths: pathSummary.rankedPaths,
      sourceNeedles: sourceNeedlesForCheck(check, expectation),
      repoRoot,
    })
    : [];
  const sourceDiscovery = buildSourceDiscoverySummary({
    sourceHints,
    sourceContext,
    recentChanges,
    suspectChanges,
    pathSummary,
  });

  return redactSensitive({
    sourceHints,
    sourceContext,
    sourceDiscovery,
  });
}

export function sourceNeedlesForCheck(check, expectation) {
  const needles = new Set();
  addNeedleWithVariants(needles, check?.checkId);
  addNeedleWithVariants(needles, check?.featureId);
  for (const value of stringsFromValue(check?.message)) addNeedleWithVariants(needles, value);
  for (const value of stringsFromValue(check?.evidence)) addNeedleWithVariants(needles, value);
  for (const value of expectation?.requiredEvidence ?? []) addNeedleWithVariants(needles, value);
  for (const assertion of expectation?.assertions ?? []) {
    addNeedleWithVariants(needles, assertion?.path);
    addNeedleWithVariants(needles, assertion?.equals);
    addNeedleWithVariants(needles, assertion?.contains);
    addNeedleWithVariants(needles, assertion?.containsIgnoreCase);
  }
  return [...needles].slice(0, 32);
}

async function findKnownSourceAnchors({
  check,
  feature,
  checkConfig,
  expectation,
  registryPath,
  expectationsPath,
  runnerPath,
  repoRoot,
}) {
  const hints = [];
  if (registryPath) {
    hints.push(...await findLiteralInFile({
      filePath: registryPath,
      repoRoot,
      needle: check?.checkId,
      kind: "registry-check",
      reason: "Registered feature check configuration.",
      priority: 100,
    }));
    hints.push(...await findLiteralInFile({
      filePath: registryPath,
      repoRoot,
      needle: feature?.id ?? check?.featureId,
      kind: "registry-feature",
      reason: "Owning feature registry entry.",
      priority: 92,
    }));
  }
  if (expectationsPath) {
    hints.push(...await findLiteralInFile({
      filePath: expectationsPath,
      repoRoot,
      needle: check?.checkId,
      kind: "expected-output-contract",
      reason: "Expected-output contract for the failing eval.",
      priority: 98,
    }));
    for (const requiredEvidence of expectation?.requiredEvidence ?? []) {
      hints.push(...await findLiteralInFile({
        filePath: expectationsPath,
        repoRoot,
        needle: requiredEvidence,
        kind: "required-evidence-contract",
        reason: "Required evidence named by the expected-output contract.",
        priority: 82,
      }));
    }
  }
  if (runnerPath) {
    hints.push(...await findLiteralInFile({
      filePath: runnerPath,
      repoRoot,
      needle: check?.checkId,
      kind: "eval-runner-branch",
      reason: "Runner branch that executes this eval.",
      priority: 96,
    }));
    for (const requiredEvidence of expectation?.requiredEvidence ?? []) {
      hints.push(...await findLiteralInFile({
        filePath: runnerPath,
        repoRoot,
        needle: requiredEvidence,
        kind: "runner-evidence-write",
        reason: "Runner code references expected evidence.",
        priority: 78,
      }));
    }
  }

  if (checkConfig) {
    addSyntheticHint(hints, {
      id: `check-config.${checkConfig.id ?? check?.checkId}`,
      kind: "check-config",
      reason: "Effective check config from the feature registry.",
      priority: 88,
      preview: JSON.stringify(checkConfig).slice(0, 500),
    });
  }
  return hints;
}

async function searchRepoForNeedles({ needles, repoRoot }) {
  const hints = [];
  for (const needle of needles) {
    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "--json",
          "-n",
          "--fixed-strings",
          "--max-count",
          "8",
          ...SEARCH_EXCLUDES,
          needle,
          repoRoot,
        ],
        { timeout: 7_500, maxBuffer: 768_000 },
      );
      for (const line of stdout.split("\n").filter(Boolean)) {
        const event = safeJsonParse(line);
        if (event?.type !== "match") continue;
        const filePath = event.data?.path?.text;
        const lineNumber = event.data?.line_number;
        const text = event.data?.lines?.text;
        if (!filePath || !Number.isFinite(Number(lineNumber))) continue;
        hints.push({
          kind: classifyNeedle(needle, text),
          needle,
          path: path.relative(repoRoot, filePath),
          line: Number(lineNumber),
          preview: String(text ?? "").trim().slice(0, 500),
          reason: `Repository match for ${needle}.`,
          priority: priorityForMatch({ needle, filePath, repoRoot, text }),
        });
      }
    } catch {
      // Source discovery is supplemental. Missing rg matches should not block investigation.
    }
    if (hints.length >= 80) break;
  }
  return hints;
}

async function findLiteralInFile({ filePath, repoRoot, needle, kind, reason, priority }) {
  if (!filePath || !needle) return [];
  try {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text.split("\n");
    const hits = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(needle)) continue;
      hits.push({
        kind,
        needle,
        path: path.relative(repoRoot, filePath),
        line: index + 1,
        preview: lines[index].trim().slice(0, 500),
        reason,
        priority,
      });
      if (hits.length >= 8) break;
    }
    return hits;
  } catch {
    return [];
  }
}

async function collectSourceContext(sourceHints, repoRoot) {
  const contexts = [];
  const seen = new Set();
  for (const hint of sourceHints) {
    if (!hint.path || !Number.isFinite(Number(hint.line))) continue;
    const key = `${hint.path}:${hint.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const filePath = path.resolve(repoRoot, hint.path);
    if (!isInsideDirectory(filePath, repoRoot)) continue;
    try {
      const lines = (await fs.readFile(filePath, "utf8")).split("\n");
      const line = Math.max(1, Number(hint.line));
      const startLine = Math.max(1, line - 4);
      const endLine = Math.min(lines.length, line + 4);
      const excerpt = lines
        .slice(startLine - 1, endLine)
        .map((text, index) => `${startLine + index}: ${text}`)
        .join("\n");
      contexts.push({
        path: hint.path,
        startLine,
        endLine,
        excerpt: excerpt.slice(0, 2_400),
        sourceHintKind: hint.kind ?? "source-match",
        sourceHintReason: hint.reason ?? null,
      });
    } catch {
      // Source context is supplementary and should never block investigation.
    }
    if (contexts.length >= 12) break;
  }
  return contexts;
}

async function collectRecentChanges(sourceHints, repoRoot) {
  const recentChanges = [];
  const paths = [...new Set(sourceHints.map((hint) => hint.path).filter(Boolean))]
    .filter((hintPath) => !hintPath.startsWith("infra/evals/reports/"))
    .slice(0, 8);
  for (const hintPath of paths) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", "--oneline", "-5", "--", hintPath],
        { cwd: repoRoot, timeout: 5_000, maxBuffer: 128_000 },
      );
      const commits = stdout.split("\n").filter(Boolean).map((line) => line.trim()).slice(0, 5);
      if (commits.length === 0) continue;
      recentChanges.push({
        path: hintPath,
        commits,
      });
    } catch {
      // Recent changes help repair-loop localization but are not required.
    }
  }
  return recentChanges;
}

function buildSourcePathSummary(sourceHints) {
  const byKind = {};
  for (const hint of sourceHints) {
    const kind = hint.kind ?? "source-match";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const rankedPaths = [];
  const scoreByPath = new Map();
  for (const hint of sourceHints) {
    if (!hint.path) continue;
    scoreByPath.set(hint.path, (scoreByPath.get(hint.path) ?? 0) + (hint.priority ?? 0));
  }
  for (const [hintPath, score] of scoreByPath.entries()) {
    rankedPaths.push({ path: hintPath, score });
  }
  rankedPaths.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const candidateCodePaths = rankedPaths
    .filter((entry) => isCandidateCodePath(entry.path))
    .slice(0, 8);

  return { byKind, rankedPaths, candidateCodePaths };
}

function suspectCandidatePaths(sourceHints, pathSummary) {
  return [...new Set([
    ...pathSummary.candidateCodePaths.map((entry) => entry.path),
    ...pathSummary.rankedPaths.filter((entry) => isCandidateCodePath(entry.path)).map((entry) => entry.path),
    ...sourceHints.map((hint) => hint.path).filter((hintPath) => hintPath && isCandidateCodePath(hintPath)),
  ])].slice(0, 10);
}

function buildSourceDiscoverySummary({
  sourceHints,
  sourceContext,
  recentChanges,
  suspectChanges,
  pathSummary,
}) {
  const { byKind, rankedPaths, candidateCodePaths } = pathSummary ?? buildSourcePathSummary(sourceHints);

  return {
    schemaVersion: 1,
    discoveryKind: "aura-observability-source-discovery",
    strategy: [
      "Anchor the failing eval to its registry entry, expected-output contract, and runner branch.",
      "Search repository code for failed messages, endpoints, evidence keys, and expected assertions.",
      "Attach bounded source excerpts and recent commits for implicated files.",
      "Rank recent commits and PRs as suspect hypotheses only; require eval and source proof before calling any change causal.",
      "Rank evidence so the investigator receives focused context instead of a broad code dump.",
    ],
    hintCount: sourceHints.length,
    contextCount: sourceContext.length,
    recentChangeCount: recentChanges.length,
    suspectChangeCount: suspectChanges.length,
    byKind,
    rankedPaths: rankedPaths.slice(0, 12),
    candidateCodePaths,
    recentChanges,
    suspectChanges,
  };
}

function emptySourceDiscovery() {
  return {
    schemaVersion: 1,
    discoveryKind: "aura-observability-source-discovery",
    strategy: [],
    hintCount: 0,
    contextCount: 0,
    recentChangeCount: 0,
    suspectChangeCount: 0,
    byKind: {},
    rankedPaths: [],
    candidateCodePaths: [],
    recentChanges: [],
    suspectChanges: [],
  };
}

function rankAndLimitHints(hints, limit) {
  const seen = new Set();
  const deduped = [];
  for (const hint of hints) {
    const key = hint.path
      ? `${hint.kind ?? "source-match"}:${hint.path}:${hint.line ?? ""}:${hint.needle ?? ""}`
      : `${hint.kind ?? "source-match"}:${hint.id ?? hint.preview}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(hint);
  }
  return deduped
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || String(left.path ?? "").localeCompare(String(right.path ?? "")))
    .slice(0, limit);
}

function addSyntheticHint(hints, hint) {
  if (!hint.preview) return;
  hints.push({
    ...hint,
    path: null,
    line: null,
    needle: null,
  });
}

function priorityForMatch({ needle, filePath, repoRoot, text }) {
  const relativePath = path.relative(repoRoot, filePath);
  let priority = 40;
  if (relativePath.includes("infra/evals/status")) priority += 18;
  if (relativePath.includes("/api/") || relativePath.includes("/routes/") || relativePath.includes("/server/")) priority += 12;
  if (isTestPath(relativePath)) priority -= 35;
  if (relativePath.includes("node_modules") || relativePath.includes("dist/")) priority -= 50;
  if (String(text ?? "").includes(needle)) priority += 4;
  if (/^\/(?:api|v\d+)\//i.test(needle)) priority += 14;
  return priority;
}

function classifyNeedle(needle, text) {
  if (/^\/(?:api|v\d+)\//i.test(needle)) return "endpoint-match";
  if (/^[A-Z0-9_:-]{6,}$/.test(needle)) return "error-code-match";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(needle)) return "evidence-key-match";
  if (String(text ?? "").includes("case ") || String(text ?? "").includes("checkId")) return "eval-runner-match";
  return "source-match";
}

function isCandidateCodePath(hintPath) {
  return Boolean(hintPath)
    && !isTestPath(hintPath)
    && !hintPath.endsWith("features.json")
    && !hintPath.endsWith("check-expectations.json")
    && !hintPath.includes("infra/evals/reports/");
}

function isTestPath(hintPath) {
  return /\.test\.[cm]?[jt]sx?$/.test(hintPath)
    || hintPath.includes("__tests__/")
    || hintPath.includes("/tests/")
    || /[_-]tests?\.[^.]+$/.test(hintPath);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isInsideDirectory(filePath, directoryPath) {
  const relativePath = path.relative(path.resolve(directoryPath), filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function addNeedleWithVariants(needles, value) {
  if (typeof value !== "string") return;
  for (const variant of variantsForNeedle(value)) addNeedle(needles, variant);
}

function addNeedle(needles, value) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 140) return;
  if (/^\d+$/.test(trimmed)) return;
  if (COMMON_SOURCE_NEEDLES.has(trimmed)) return;
  needles.add(trimmed);
}

function variantsForNeedle(value) {
  const variants = new Set([value]);
  if (value.includes("-")) {
    variants.add(value.replace(/-/g, "_"));
    variants.add(toCamelCase(value));
  }
  if (value.includes("_")) {
    variants.add(value.replace(/_/g, "-"));
    variants.add(toCamelCase(value));
  }
  const endpointMatches = value.match(/\/(?:api|v\d+)[a-z0-9/_:.-]*/gi) ?? [];
  for (const endpoint of endpointMatches) variants.add(endpoint);
  const codeMatches = value.match(/[a-z][a-z0-9_:-]{5,}/g) ?? [];
  for (const code of codeMatches) variants.add(code);
  const errorCodeMatches = value.match(/[A-Z][A-Z0-9_]{5,}/g) ?? [];
  for (const code of errorCodeMatches) variants.add(code);
  return [...variants];
}

function toCamelCase(value) {
  return value.replace(/[-_]([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function stringsFromValue(value, strings = []) {
  if (value == null) return strings;
  if (typeof value === "string") {
    strings.push(value);
    const endpointMatches = value.match(/\/(?:api|v\d+)[a-z0-9/_:.-]*/gi) ?? [];
    for (const endpoint of endpointMatches) strings.push(endpoint);
    const codeMatches = value.match(/[a-z][a-z0-9_:-]{5,}/g) ?? [];
    for (const code of codeMatches) strings.push(code);
    const errorCodeMatches = value.match(/[A-Z][A-Z0-9_]{5,}/g) ?? [];
    for (const code of errorCodeMatches) strings.push(code);
    return strings;
  }
  if (typeof value !== "object") return strings;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) stringsFromValue(entry, strings);
    return strings;
  }
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    strings.push(key);
    stringsFromValue(entry, strings);
  }
  return strings;
}
