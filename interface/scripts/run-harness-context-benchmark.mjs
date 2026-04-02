import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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

const ANTHROPIC_MODEL_PRICING_PER_MTOK = {
  "claude-opus-4-6": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4.6": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4.5": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4-1": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-opus-4.1": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-4.6": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-4.5": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
};

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

function toJsonMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeModelKey(model) {
  return typeof model === "string" ? model.trim().toLowerCase() : "";
}

function inferProvider(model, provider) {
  if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  const modelKey = normalizeModelKey(model);
  if (modelKey.startsWith("claude")) return "anthropic";
  if (modelKey.startsWith("gpt") || modelKey.startsWith("o1") || modelKey.startsWith("o3")) {
    return "openai";
  }
  return null;
}

function resolvePricing(model, provider) {
  const inferredProvider = inferProvider(model, provider);
  const modelKey = normalizeModelKey(model);
  if (inferredProvider === "anthropic") {
    const pricing = ANTHROPIC_MODEL_PRICING_PER_MTOK[modelKey];
    if (pricing) {
      return {
        provider: inferredProvider,
        model: modelKey,
        source: "anthropic-pricing",
        ...pricing,
      };
    }
  }
  return null;
}

function calculateEstimatedCostUsd(usage) {
  const pricing = resolvePricing(usage.model, usage.provider);
  if (!pricing) {
    return { estimatedCostUsd: 0, pricing: null };
  }

  const estimatedCostUsd =
    (usage.inputTokens / 1_000_000) * pricing.input
    + (usage.outputTokens / 1_000_000) * pricing.output
    + (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWrite
    + (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheRead;

  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    pricing,
  };
}

function readUsage(message) {
  const usage = asRecord(message.usage);
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: Number(usage.cache_creation_input_tokens ?? 0),
    cacheReadInputTokens: Number(usage.cache_read_input_tokens ?? 0),
    estimatedContextTokens: Number(usage.estimated_context_tokens ?? 0),
    contextUtilization: Number(usage.context_utilization ?? 0),
    model: typeof usage.model === "string" ? usage.model : null,
    provider: typeof usage.provider === "string" ? usage.provider : null,
  };
}

function countFilesChanged(message) {
  const filesChanged = asRecord(message.files_changed);
  if (!filesChanged) return 0;
  return ["created", "modified", "deleted"].reduce((count, key) => {
    const value = filesChanged[key];
    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
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
    legacyVisibleInputTokens: totals.totalInputTokens,
    legacyTelemetryGapTokens:
      totals.totalCacheCreationInputTokens + totals.totalCacheReadInputTokens,
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

function openHarnessSession() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(harnessWsUrl);
    const state = {
      socket,
      sessionReady: false,
      pendingTurn: null,
      turns: [],
    };

    socket.addEventListener("open", () => resolve(state));
    socket.addEventListener("error", (event) => reject(event.error ?? new Error("WebSocket error")));
  });
}

async function waitForSessionReady(state, workspacePath) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "session_ready") {
        state.sessionReady = true;
        state.socket.removeEventListener("message", onMessage);
        resolve({
          ...message,
          sessionInitMs: Date.now() - startedAt,
        });
      } else if (message.type === "error") {
        state.socket.removeEventListener("message", onMessage);
        reject(new Error(message.message ?? "session init failed"));
      }
    };

    state.socket.addEventListener("message", onMessage);
    state.socket.send(toJsonMessage("session_init", {
      project_path: workspacePath,
      max_turns: 16,
      max_tokens: Number.isFinite(sessionMaxTokens) ? sessionMaxTokens : 2048,
      token: accessToken || undefined,
    }));
  });
}

async function runTurn(state, prompt, turnIndex) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const turn = {
      turnIndex,
      prompt,
      text: "",
      toolNames: [],
      toolResults: [],
      usage: null,
      fileChangeCount: 0,
      rawEnd: null,
      firstEventAt: null,
      completedAt: null,
      wallClockMs: null,
      timeToFirstEventMs: null,
      stopReason: null,
      estimatedCostUsd: 0,
      pricing: null,
    };

    const markFirstEvent = () => {
      if (turn.firstEventAt == null) {
        turn.firstEventAt = Date.now();
        turn.timeToFirstEventMs = turn.firstEventAt - startedAt;
      }
    };

    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      switch (message.type) {
        case "text_delta":
          markFirstEvent();
          turn.text += message.text ?? "";
          break;
        case "thinking_delta":
          markFirstEvent();
          break;
        case "tool_use_start":
          markFirstEvent();
          if (typeof message.name === "string") {
            turn.toolNames.push(message.name);
          }
          break;
        case "tool_result":
          markFirstEvent();
          turn.toolResults.push({
            name: typeof message.name === "string" ? message.name : "unknown",
            isError: Boolean(message.is_error),
            resultPreview:
              typeof message.result === "string"
                ? message.result.slice(0, 240)
                : "",
          });
          break;
        case "assistant_message_end":
          markFirstEvent();
          turn.rawEnd = message;
          turn.usage = readUsage(message);
          turn.fileChangeCount = countFilesChanged(message);
          turn.stopReason = typeof message.stop_reason === "string" ? message.stop_reason : null;
          turn.completedAt = Date.now();
          turn.wallClockMs = turn.completedAt - startedAt;
          if (turn.usage) {
            const { estimatedCostUsd, pricing } = calculateEstimatedCostUsd(turn.usage);
            turn.estimatedCostUsd = estimatedCostUsd;
            turn.pricing = pricing;
          }
          state.socket.removeEventListener("message", onMessage);
          resolve(turn);
          break;
        case "error":
          state.socket.removeEventListener("message", onMessage);
          reject(new Error(message.message ?? "turn failed"));
          break;
        default:
          break;
      }
    };

    state.socket.addEventListener("message", onMessage);
    state.socket.send(toJsonMessage("user_message", {
      content: prompt,
    }));
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
    const ready = await waitForSessionReady(session, workspaceDir);
    logStep("session ready");

    const turns = [];
    for (const [index, prompt] of scenario.prompts.entries()) {
      logStep("turn start", { turn: index + 1 });
      const turn = await runTurn(session, prompt, index + 1);
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
