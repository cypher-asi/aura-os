import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function appendChunk(current, chunk, cap = 4 * 1024 * 1024) {
  const combined = current + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

export function normalizeAdapterLabel(adapterId) {
  switch (adapterId) {
    case "aura":
      return "Aura";
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return adapterId;
  }
}

export async function runProcess(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    stdinText = null,
    timeoutMs = 10 * 60 * 1000,
  } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout = appendChunk(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendChunk(stderr, chunk.toString());
    });

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        timedOut,
        wallClockMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        timedOut,
        wallClockMs: Date.now() - startedAt,
        stdout,
        stderr: appendChunk(stderr, error.message),
      });
    });

    if (stdinText != null) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

export async function runValidation(workspaceDir, scenario) {
  const validationCommand = scenario.validationCommand;
  if (!validationCommand?.command) {
    return {
      passed: null,
      exitCode: null,
      stdout: "",
      stderr: "",
    };
  }

  const result = await runProcess(
    validationCommand.command,
    validationCommand.args ?? [],
    { cwd: workspaceDir, timeoutMs: 60_000 },
  );
  return {
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function collectFiles(rootDir, relativeDir = "") {
  const dirPath = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nextRelative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(rootDir, nextRelative));
      continue;
    }
    files.push(nextRelative);
  }
  return files.sort();
}

async function readFileIfPresent(rootDir, relativePath) {
  try {
    return await fs.readFile(path.join(rootDir, relativePath));
  } catch {
    return null;
  }
}

export async function writeWorkspaceDiffArtifacts(resultsDir, runId, fixtureDir, workspaceDir) {
  const patchPath = path.join(resultsDir, `${runId}.patch`);
  const patchResult = await runProcess(
    "git",
    [
      "diff",
      "--no-index",
      "--binary",
      "--no-ext-diff",
      "--src-prefix=fixture/",
      "--dst-prefix=workspace/",
      fixtureDir,
      workspaceDir,
    ],
    { cwd: workspaceDir, timeoutMs: 30_000 },
  );

  await fs.writeFile(patchPath, patchResult.stdout, "utf8");

  const fixtureFiles = await collectFiles(fixtureDir);
  const workspaceFiles = await collectFiles(workspaceDir);
  const allFiles = new Set([...fixtureFiles, ...workspaceFiles]);
  const changedFiles = {
    created: [],
    modified: [],
    deleted: [],
  };

  for (const relativePath of Array.from(allFiles).sort()) {
    const fixtureContent = await readFileIfPresent(fixtureDir, relativePath);
    const workspaceContent = await readFileIfPresent(workspaceDir, relativePath);

    if (fixtureContent == null && workspaceContent != null) {
      changedFiles.created.push(relativePath);
      continue;
    }
    if (fixtureContent != null && workspaceContent == null) {
      changedFiles.deleted.push(relativePath);
      continue;
    }
    if (fixtureContent != null && workspaceContent != null && !fixtureContent.equals(workspaceContent)) {
      changedFiles.modified.push(relativePath);
    }
  }

  return {
    patchPath,
    changedFiles,
  };
}

export async function snapshotWorkspace(rootDir) {
  const files = await collectFiles(rootDir);
  return files.map((relativePath) => ({ relativePath }));
}

export function buildExternalBenchmarkResult(input) {
  const {
    adapterId,
    scenario,
    command,
    processResult,
    validation,
    workspaceArtifacts,
    transcriptPath,
    workspaceDir,
    usage = null,
    provider = null,
    model = null,
    extra = {},
  } = input;

  const qualityPass = validation.passed === null ? processResult.exitCode === 0 : Boolean(validation.passed);
  const success = processResult.exitCode === 0 && !processResult.timedOut && qualityPass;

  return {
    suite: "external-agent-benchmark",
    adapter: adapterId,
    adapterLabel: normalizeAdapterLabel(adapterId),
    scenarioId: scenario.id,
    title: `${normalizeAdapterLabel(adapterId)} · ${scenario.title}`,
    generatedAt: new Date().toISOString(),
    success,
    qualityPass,
    promptMode: scenario.adapterMode,
    command,
    metrics: {
      runWallClockMs: processResult.wallClockMs,
      estimatedCostUsd: usage?.estimatedCostUsd ?? null,
      totalInputTokens: usage?.inputTokens ?? null,
      totalOutputTokens: usage?.outputTokens ?? null,
      totalCacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
      totalCacheReadInputTokens: usage?.cacheReadInputTokens ?? null,
      maxEstimatedContextTokens: usage?.estimatedContextTokens ?? null,
      maxContextUtilization: usage?.contextUtilization ?? null,
      totalTokens:
        usage && Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens)
          ? usage.inputTokens + usage.outputTokens
          : null,
    },
    usage: {
      ...usage,
      provider,
      model,
    },
    quality: validation,
    filesChanged: workspaceArtifacts.changedFiles,
    artifacts: {
      transcriptPath,
      patchPath: workspaceArtifacts.patchPath,
      workspaceDir,
    },
    process: {
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      stderrPreview: processResult.stderr.slice(-4000),
    },
    ...extra,
  };
}
