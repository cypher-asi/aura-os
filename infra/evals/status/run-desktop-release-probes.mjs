#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const DEFAULT_CHECKS = [
  "api-health",
  "auth-session",
  "orgs-list",
  "user-profile",
  "workspace-defaults",
  "terminal-list",
  "desktop-update-runtime",
  "local-agent-create",
  "local-agent-runtime",
  "local-agent-permissions",
  "project-agent-chat-stream",
  "session-share-public-read",
  "harness-memory-roundtrip",
  "harness-skills-roundtrip",
  "notes-crud",
  "process-run-lifecycle",
  "model-matrix",
  "analytics-contract-artifacts",
];

function parseArgs(argv) {
  const args = {
    binary: process.env.AURA_DESKTOP_BINARY || "",
    port: process.env.AURA_STATUS_DESKTOP_PORT || process.env.AURA_SERVER_PORT || "19847",
    baseUrl: process.env.AURA_STATUS_DESKTOP_BASE_URL || "",
    publicBaseUrl: process.env.AURA_STATUS_PUBLIC_BASE_URL || "",
    checks: process.env.AURA_STATUS_DESKTOP_CHECKS || DEFAULT_CHECKS.join(","),
    runtimeEnvironment: process.env.AURA_STATUS_RUNTIME_ENVIRONMENT || "desktop-release",
    outDir:
      process.env.AURA_STATUS_CHECKS_DIR ||
      path.join(repoRoot, "infra/evals/reports/status/checks"),
    environment: process.env.AURA_STATUS_ENVIRONMENT || "desktop-release",
    timeoutMs: Number(process.env.AURA_STATUS_DESKTOP_READY_TIMEOUT_MS || "120000"),
    logDir: process.env.AURA_STATUS_DESKTOP_LOG_DIR || path.resolve(repoRoot, "desktop-status-logs"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--binary") args.binary = next();
    else if (arg === "--port") args.port = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--public-base-url") args.publicBaseUrl = next();
    else if (arg === "--checks") args.checks = next();
    else if (arg === "--runtime-environment") args.runtimeEnvironment = next();
    else if (arg === "--out-dir") args.outDir = path.resolve(next());
    else if (arg === "--environment") args.environment = next();
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next());
    else if (arg === "--log-dir") args.logDir = path.resolve(next());
    else if (arg === "--help") {
      process.stdout.write(
        "Usage: node infra/evals/status/run-desktop-release-probes.mjs --binary PATH [--public-base-url URL] [--checks a,b] [--out-dir DIR]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.binary) throw new Error("AURA_DESKTOP_BINARY or --binary is required");
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  args.binary = path.resolve(args.binary);
  args.baseUrl = (args.baseUrl || `http://127.0.0.1:${args.port}`).replace(/\/+$/, "");
  args.publicBaseUrl = args.publicBaseUrl.replace(/\/+$/, "");
  return args;
}

function launchCommand(args) {
  if (process.platform === "linux") {
    return { command: "xvfb-run", argv: ["-a", args.binary] };
  }
  return { command: args.binary, argv: [] };
}

async function fetchJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForDesktopReady(args, child) {
  const deadline = Date.now() + args.timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.auraStartError) {
      throw new Error(`desktop failed to start: ${child.auraStartError.message}`);
    }
    if (child.exitCode != null) {
      throw new Error(`desktop exited before becoming ready with code ${child.exitCode}`);
    }
    try {
      const health = await fetchJson(`${args.baseUrl}/health`);
      if (health?.status !== "ok") throw new Error(`/health returned ${JSON.stringify(health)}`);
      const update = await fetchJson(`${args.baseUrl}/api/update-status`);
      if (!update?.current_version) throw new Error("/api/update-status missing current_version");
      return { health, update };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`timed out waiting for desktop at ${args.baseUrl}: ${lastError}`);
}

function runProbes(args) {
  const probeArgs = [
    path.join(__dirname, "run-status-probes.mjs"),
    "--base-url",
    args.baseUrl,
    "--checks",
    args.checks,
    "--out-dir",
    args.outDir,
    "--environment",
    args.environment,
    "--runtime-environment",
    args.runtimeEnvironment,
  ];
  if (args.publicBaseUrl) {
    probeArgs.push("--public-base-url", args.publicBaseUrl);
  }
  return new Promise((resolve, reject) => {
    const probe = spawn(
      process.execPath,
      probeArgs,
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AURA_STATUS_API_BASE_URL: args.baseUrl,
          AURA_STATUS_ENVIRONMENT: args.environment,
          AURA_STATUS_RUNTIME_ENVIRONMENT: args.runtimeEnvironment,
          AURA_STATUS_CHECKS_DIR: args.outDir,
          AURA_STATUS_PUBLIC_BASE_URL: args.publicBaseUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    probe.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    probe.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    probe.on("error", reject);
    probe.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`desktop status probes exited with ${code ?? 1}`));
    });
  });
}

async function terminate(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const args = parseArgs(process.argv.slice(2));
if (!fs.existsSync(args.binary)) throw new Error(`desktop binary does not exist: ${args.binary}`);
fs.mkdirSync(args.logDir, { recursive: true });
fs.mkdirSync(args.outDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-desktop-status-"));
const stdoutPath = path.join(args.logDir, "desktop.stdout.log");
const stderrPath = path.join(args.logDir, "desktop.stderr.log");
const stdout = fs.createWriteStream(stdoutPath, { flags: "w" });
const stderr = fs.createWriteStream(stderrPath, { flags: "w" });
const launch = launchCommand(args);
const child = spawn(launch.command, launch.argv, {
  cwd: repoRoot,
  env: {
    ...process.env,
    AURA_DESKTOP_CI: "1",
    AURA_SERVER_PORT: String(args.port),
    AURA_DATA_DIR: dataDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.once("error", (error) => {
  child.auraStartError = error;
});
child.stdout.pipe(stdout);
child.stderr.pipe(stderr);

try {
  const ready = await waitForDesktopReady(args, child);
  process.stdout.write(
    `desktop ready at ${args.baseUrl} version=${ready.update.current_version} channel=${ready.update.channel ?? "unknown"}\n`,
  );
  await runProbes(args);
  process.stdout.write(`desktop logs: ${stdoutPath}, ${stderrPath}\n`);
} finally {
  await terminate(child);
  stdout.end();
  stderr.end();
}
