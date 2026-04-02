import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  openHarnessSession,
  runHarnessTurn,
  waitForHarnessSessionReady,
} from "./lib/harness-session-runner.mjs";
import {
  getHarnessBenchmarkScenario,
  prepareHarnessBenchmarkWorkspace,
} from "./lib/harness-benchmark-scenarios.mjs";

const interfaceRoot = process.cwd();
const resultsDir = path.resolve(interfaceRoot, process.env.AURA_EVAL_RESULTS_DIR ?? "test-results");
const harnessBaseUrl = process.env.AURA_EVAL_HARNESS_URL?.trim() || "http://127.0.0.1:3404";
const harnessWsUrl = `${harnessBaseUrl.replace(/^http/, "ws")}/stream`;
const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
const device = process.env.AURA_EVAL_SCENARIO_DEVICE?.trim() || "local";
const scenarioId = process.env.AURA_EVAL_SCENARIO_ID?.trim() || "harness-context-static-site";
const verbose = process.env.AURA_EVAL_VERBOSE === "1";
const sessionMaxTokens = Number(process.env.AURA_EVAL_MAX_TOKENS ?? 2048);
const keepWorkspace = process.env.AURA_EVAL_KEEP_WORKSPACE === "1";

const scenario = getHarnessBenchmarkScenario(interfaceRoot, scenarioId);
const title = process.env.AURA_EVAL_SCENARIO_TITLE?.trim() || scenario.title;

function logStep(message, details) {
  if (!verbose) return;
  if (details === undefined) {
    process.stderr.write(`[harness-benchmark] ${message}\n`);
    return;
  }
  process.stderr.write(`[harness-benchmark] ${message} ${JSON.stringify(details)}\n`);
}

function summarizeTurns(turns) {
  const models = new Set();
  const providers = new Set();
  const pricingSources = new Set();

  const totals = turns.reduce((acc, turn) => {
    const usage = turn.usage;
    acc.totalWallClockMs += turn.wallClockMs ?? 0;
    acc.totalTimeToFirstEventMs += turn.timeToFirstEventMs ?? 0;
    acc.maxTurnWallClockMs = Math.max(acc.maxTurnWallClockMs, turn.wallClockMs ?? 0);
    acc.turnsWithErrors += turn.stopReason?.includes("error") ? 1 : 0;

    if (usage) {
      if (usage.model) models.add(usage.model);
      if (usage.provider) providers.add(usage.provider);
      if (turn.pricing?.source) pricingSources.add(turn.pricing.source);

      acc.totalInputTokens += usage.inputTokens;
      acc.totalOutputTokens += usage.outputTokens;
      acc.totalCacheCreationInputTokens += usage.cacheCreationInputTokens;
      acc.totalCacheReadInputTokens += usage.cacheReadInputTokens;
      acc.promptInputFootprintTokens +=
        usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
      acc.maxEstimatedContextTokens = Math.max(
        acc.maxEstimatedContextTokens,
        usage.estimatedContextTokens,
      );
      acc.maxContextUtilization = Math.max(
        acc.maxContextUtilization,
        usage.contextUtilization,
      );
      acc.estimatedCostUsd += turn.estimatedCostUsd ?? 0;
    }

    acc.fileChangeCount += turn.fileChangeCount;
    return acc;
  }, {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    promptInputFootprintTokens: 0,
    maxEstimatedContextTokens: 0,
    maxContextUtilization: 0,
    fileChangeCount: 0,
    estimatedCostUsd: 0,
    totalWallClockMs: 0,
    totalTimeToFirstEventMs: 0,
    maxTurnWallClockMs: 0,
    turnsWithErrors: 0,
  });

  const completedTurns = turns.length || 1;
  return {
    ...totals,
    totalTokens: totals.totalInputTokens + totals.totalOutputTokens,
    richUsageSessions: 1,
    fallbackUsageSessions: 0,
    richUsageTurns: turns.filter((turn) => turn.usage).length,
    fallbackUsageTurns: 0,
    estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(6)),
    models: Array.from(models).sort(),
    providers: Array.from(providers).sort(),
    pricingSources: Array.from(pricingSources).sort(),
    averageTurnWallClockMs: Number((totals.totalWallClockMs / completedTurns).toFixed(2)),
    averageTimeToFirstEventMs: Number((totals.totalTimeToFirstEventMs / completedTurns).toFixed(2)),
  };
}

async function summarizeWorkspaceQuality(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
    .map((entry) => entry.name);
  const cssFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".css"))
    .map((entry) => entry.name);

  const htmlContents = await Promise.all(
    htmlFiles.map(async (file) => ({
      file,
      content: await fs.readFile(path.join(rootDir, file), "utf8"),
    })),
  );
  const cssContents = await Promise.all(
    cssFiles.map(async (file) => ({
      file,
      content: await fs.readFile(path.join(rootDir, file), "utf8"),
    })),
  );

  const primaryHtml = htmlContents[0]?.content ?? "";
  const combinedHtml = htmlContents.map((entry) => entry.content).join("\n");
  const combinedCss = cssContents.map((entry) => entry.content).join("\n");

  const footerPresent = /<footer\b/i.test(combinedHtml);
  const ctaChanged =
    !/>Learn more</i.test(combinedHtml)
    && /(get started|start shipping|start building|explore features|get started free)/i.test(combinedHtml);
  const featuresSignal =
    /features/i.test(combinedHtml)
    || (combinedHtml.match(/<article\b/gi)?.length ?? 0) >= 3
    || (combinedHtml.match(/feature/gi)?.length ?? 0) >= 3
    || (combinedHtml.match(/<li\b/gi)?.length ?? 0) >= 3;
  const stylesTouchFooter = /\bfooter\b/i.test(combinedCss) || /<style[\s\S]*footer/i.test(combinedHtml);
  const embeddedStyles = /<style\b/i.test(combinedHtml);
  const workspaceMaterialized =
    htmlFiles.length >= 1
    && primaryHtml.length > 500
    && (cssFiles.length >= 1 || embeddedStyles);
  const qualityPass =
    workspaceMaterialized
    && footerPresent
    && featuresSignal
    && stylesTouchFooter;

  return {
    workspaceMaterialized,
    footerPresent,
    ctaChanged,
    featuresSignal,
    stylesTouchFooter,
    embeddedStyles,
    qualityPass,
    htmlFileCount: htmlFiles.length,
    cssFileCount: cssFiles.length,
    indexHtmlBytes: Buffer.byteLength(primaryHtml, "utf8"),
    stylesCssBytes: Buffer.byteLength(combinedCss, "utf8"),
  };
}

async function snapshotWorkspace(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function verifyPreparedWorkspace(rootDir, scenarioConfig) {
  const requiredFiles = Array.isArray(scenarioConfig.requiredFiles)
    ? scenarioConfig.requiredFiles
    : [];
  const checks = await Promise.all(requiredFiles.map(async (relativePath) => {
    try {
      await fs.access(path.join(rootDir, relativePath));
      return { relativePath, present: true };
    } catch {
      return { relativePath, present: false };
    }
  }));

  return {
    rootEntries: await snapshotWorkspace(rootDir),
    requiredFiles: checks,
    ready: checks.every((check) => check.present),
  };
}

function evaluateTurnTraceQuality(turns, scenarioConfig) {
  const combinedTurnText = turns
    .map((turn) => (typeof turn?.text === "string" ? turn.text : ""))
    .join("\n")
    .toLowerCase();
  const hasWriteLikeTools = turns.some((turn) =>
    Array.isArray(turn?.toolNames)
    && turn.toolNames.some((tool) => scenarioConfig.preferredTools.includes(tool))
  );
  const matchedTerms = scenarioConfig.expectedTerms.filter((term) => combinedTurnText.includes(term));

  return {
    hasWriteLikeTools,
    matchedTerms,
    matchedAllExpectedTerms: matchedTerms.length >= Math.min(2, scenarioConfig.expectedTerms.length),
    qualityPass:
      hasWriteLikeTools
      && matchedTerms.length >= Math.min(2, scenarioConfig.expectedTerms.length),
  };
}

async function runScenarioValidation(rootDir, scenarioConfig) {
  if (!scenarioConfig.validationCommand?.command) {
    return null;
  }

  return new Promise((resolve) => {
    const child = spawn(
      scenarioConfig.validationCommand.command,
      scenarioConfig.validationCommand.args ?? [],
      {
        cwd: rootDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        passed: code === 0,
        exitCode: code ?? null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    child.on("error", (error) => {
      resolve({
        passed: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: error.message,
      });
    });
  });
}

async function main() {
  await fs.mkdir(resultsDir, { recursive: true });

  const runId = `${scenarioId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const workspaceDir = path.join(os.tmpdir(), runId);
  const runStartedAt = Date.now();
  await prepareHarnessBenchmarkWorkspace(interfaceRoot, scenario, workspaceDir);
  const workspaceBeforeSession = await verifyPreparedWorkspace(workspaceDir, scenario);
  logStep("workspace prepared", { workspaceDir, harnessBaseUrl });

  const session = await openHarnessSession();
  try {
    const ready = await waitForHarnessSessionReady(session, {
      workspacePath: workspaceDir,
      accessToken,
      maxTurns: 16,
      maxTokens: Number.isFinite(sessionMaxTokens) ? sessionMaxTokens : 2048,
    });
    logStep("session ready");

    const turns = [];
    for (const [index, prompt] of scenario.prompts.entries()) {
      logStep("turn start", { turn: index + 1 });
      const turn = await runHarnessTurn(session, prompt, index + 1);
      turns.push(turn);
      logStep("turn complete", {
        turn: index + 1,
        tools: turn.toolNames,
        usage: turn.usage,
        fileChangeCount: turn.fileChangeCount,
      });
    }

    const validation = await runScenarioValidation(workspaceDir, scenario);
    const workspaceQuality = await summarizeWorkspaceQuality(workspaceDir);
    const traceQuality = evaluateTurnTraceQuality(turns, scenario);
    const qualityPass = scenario.validationCommand?.command
      ? Boolean(validation?.passed)
      : (Boolean(workspaceQuality.qualityPass) || Boolean(traceQuality.qualityPass));
    const quality = {
      validationPassed: validation?.passed ?? null,
      validationExitCode: validation?.exitCode ?? null,
      validationStdout: validation?.stdout ?? null,
      validationStderr: validation?.stderr ?? null,
      ...workspaceQuality,
      ...traceQuality,
      qualityPass,
    };
    const metrics = {
      ...summarizeTurns(turns),
      runWallClockMs: Date.now() - runStartedAt,
      sessionInitMs: ready.sessionInitMs ?? 0,
    };
    const payload = {
      suite: "benchmark",
      scenarioId,
      title,
      device,
      generatedAt: new Date().toISOString(),
      counts: {
        doneTasks: quality.qualityPass ? 1 : 0,
        failedTasks: quality.qualityPass ? 0 : 1,
      },
      metrics,
      quality,
      turns,
      workspaceDir,
      workspaceBeforeSession,
      harnessBaseUrl,
    };

    const outputPath = path.join(resultsDir, `${runId}.json`);
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    process.stdout.write(`${outputPath}\n`);
  } finally {
    session.socket.close();
    if (!keepWorkspace) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  }
}

await main();
