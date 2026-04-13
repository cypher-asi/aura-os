#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    app: "",
    updateBundle: "",
    signature: "",
    targetVersion: "",
    channel: "stable",
    serverPort: Number(process.env.AURA_SERVER_PORT || "19847"),
    updatePort: Number(process.env.AURA_UPDATE_SMOKE_PORT || "8765"),
    timeoutMs: Number(process.env.AURA_DESKTOP_SMOKE_TIMEOUT_MS || "180000"),
    logDir: process.env.AURA_DESKTOP_SMOKE_LOG_DIR || path.resolve("desktop-smoke-logs/local-auto-update"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--app":
        options.app = next || "";
        index += 1;
        break;
      case "--update-bundle":
        options.updateBundle = next || "";
        index += 1;
        break;
      case "--signature":
        options.signature = next || "";
        index += 1;
        break;
      case "--target-version":
        options.targetVersion = next || "";
        index += 1;
        break;
      case "--channel":
        options.channel = next || "";
        index += 1;
        break;
      case "--server-port":
        options.serverPort = Number(next || "0");
        index += 1;
        break;
      case "--update-port":
        options.updatePort = Number(next || "0");
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(next || "0");
        index += 1;
        break;
      case "--log-dir":
        options.logDir = next || "";
        index += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.app || !options.updateBundle || !options.signature || !options.targetVersion) {
    throw new Error("--app, --update-bundle, --signature, and --target-version are required");
  }
  if (!["stable", "nightly"].includes(options.channel)) {
    throw new Error(`unsupported channel: ${options.channel}`);
  }
  if (!Number.isFinite(options.serverPort) || options.serverPort <= 0) {
    throw new Error(`invalid --server-port: ${options.serverPort}`);
  }
  if (!Number.isFinite(options.updatePort) || options.updatePort <= 0) {
    throw new Error(`invalid --update-port: ${options.updatePort}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`invalid --timeout-ms: ${options.timeoutMs}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node infra/scripts/release/desktop-local-auto-update-smoke.mjs \\
    --app /path/to/Aura.app \\
    --update-bundle /path/to/Aura-update.app.tar.gz \\
    --signature /path/to/Aura-update.app.tar.gz.sig \\
    --target-version 0.1.1
`);
}

function hostArch() {
  switch (os.arch()) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    default:
      throw new Error(`unsupported host arch for update smoke: ${os.arch()}`);
  }
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function ensureDirectory(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label} not found: ${dirPath}`);
  }
}

function realPath(targetPath) {
  return fs.realpathSync.native(targetPath);
}

function findAppExecutable(appPath) {
  const macOsDir = path.join(appPath, "Contents", "MacOS");
  ensureDirectory(macOsDir, "app executable directory");
  const entries = fs.readdirSync(macOsDir)
    .map((name) => path.join(macOsDir, name))
    .filter((fullPath) => fs.statSync(fullPath).isFile());
  if (entries.length !== 1) {
    throw new Error(`expected exactly one executable in ${macOsDir}, found ${entries.length}`);
  }
  return entries[0];
}

function readBundleVersion(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  ensureFile(plistPath, "app Info.plist");
  return execFileSync(
    "plutil",
    ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plistPath],
    { encoding: "utf8" },
  ).trim();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`failed to parse JSON from ${url}: ${error}`);
    }
  }
  return { response, json, text };
}

function startUpdateServer({ channel, updatePort, updateBundle, signature, targetVersion }) {
  const updateBundleName = path.basename(updateBundle);
  const signatureValue = fs.readFileSync(signature, "utf8").trim();
  const arch = hostArch();
  const manifestPath = `/${channel}/macos/${arch}.json`;
  const bundleUrl = `http://127.0.0.1:${updatePort}/${updateBundleName}`;

  const server = http.createServer((req, res) => {
    const reqPath = req.url || "/";
    if (reqPath === manifestPath) {
      const manifest = {
        version: targetVersion,
        url: bundleUrl,
        signature: signatureValue,
        format: "app",
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }

    if (reqPath === `/${updateBundleName}`) {
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(fs.statSync(updateBundle).size),
      });
      fs.createReadStream(updateBundle).pipe(res);
      return;
    }

    if (reqPath === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, manifestPath, bundleUrl }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found", path: reqPath }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(updatePort, "127.0.0.1", () => resolve({
      server,
      manifestPath,
      bundleUrl,
    }));
  });
}

async function waitForDesktopReady(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const root = await fetch(baseUrl);
      if (!root.ok) {
        throw new Error(`root returned ${root.status}`);
      }
      const html = await root.text();
      if (!html.includes("<div id=\"root\">") && !html.includes("<div id='root'>")) {
        throw new Error("frontend root marker missing");
      }

      const update = await fetchJson(`${baseUrl}/api/update-status`);
      if (!update.response.ok) {
        throw new Error(`/api/update-status returned ${update.response.status}`);
      }
      return update.json;
    } catch (_error) {
      await sleep(1000);
    }
  }

  throw new Error(`timed out waiting for desktop readiness at ${baseUrl}`);
}

async function triggerImmediateRecheck(baseUrl, channel) {
  const response = await fetchJson(`${baseUrl}/api/update-channel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel }),
  });
  if (!response.response.ok || !response.json?.ok) {
    throw new Error(`failed to trigger update recheck: ${response.text}`);
  }
}

async function triggerInstall(baseUrl) {
  const response = await fetchJson(`${baseUrl}/api/update-install`, {
    method: "POST",
  });
  if (!response.response.ok || !response.json?.ok) {
    throw new Error(`failed to trigger update install: ${response.text}`);
  }
}

function terminateProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 5000).unref();
}

function killBundleProcesses(executablePath) {
  try {
    execFileSync("pkill", ["-f", executablePath]);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("desktop local auto-update smoke currently supports macOS only");
  }

  const options = parseArgs(process.argv.slice(2));
  const appPath = realPath(path.resolve(options.app));
  const updateBundle = realPath(path.resolve(options.updateBundle));
  const signature = realPath(path.resolve(options.signature));

  ensureDirectory(appPath, "app bundle");
  ensureFile(updateBundle, "update bundle");
  ensureFile(signature, "update signature");

  const currentVersion = readBundleVersion(appPath);
  const executablePath = findAppExecutable(appPath);
  const baseUrl = `http://127.0.0.1:${options.serverPort}`;

  if (currentVersion === options.targetVersion) {
    throw new Error(`app bundle is already at target version ${options.targetVersion}`);
  }

  fs.mkdirSync(options.logDir, { recursive: true });
  const stdoutPath = path.join(options.logDir, "desktop.stdout.log");
  const stderrPath = path.join(options.logDir, "desktop.stderr.log");
  const stdout = fs.createWriteStream(stdoutPath, { flags: "w" });
  const stderr = fs.createWriteStream(stderrPath, { flags: "w" });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-desktop-update-smoke-"));

  const { server, manifestPath, bundleUrl } = await startUpdateServer({
    channel: options.channel,
    updatePort: options.updatePort,
    updateBundle,
    signature,
    targetVersion: options.targetVersion,
  });

  let child;
  let lastStatus = null;
  let availableObserved = false;
  let installTriggered = false;
  let installingObserved = false;

  try {
    child = spawn(executablePath, [], {
      env: {
        ...process.env,
        AURA_DESKTOP_CI: "1",
        AURA_SERVER_PORT: String(options.serverPort),
        AURA_UPDATE_BASE_URL: `http://127.0.0.1:${options.updatePort}`,
        AURA_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    const readyState = await waitForDesktopReady(baseUrl, Math.min(options.timeoutMs, 120000));
    await triggerImmediateRecheck(baseUrl, readyState.channel || options.channel);

    const startedAt = Date.now();
    while (Date.now() - startedAt < options.timeoutMs) {
      const nextVersion = readBundleVersion(appPath);
      if (nextVersion === options.targetVersion) {
        console.log(JSON.stringify({
          ok: true,
          currentVersion,
          targetVersion: options.targetVersion,
          finalBundleVersion: nextVersion,
          baseUrl,
          updateBaseUrl: `http://127.0.0.1:${options.updatePort}`,
          manifestPath,
          bundleUrl,
          installingObserved,
          lastStatus,
          logs: { stdout: stdoutPath, stderr: stderrPath },
        }, null, 2));
        return;
      }

      try {
        const statusResponse = await fetchJson(`${baseUrl}/api/update-status`);
        if (statusResponse.response.ok && statusResponse.json?.update) {
          lastStatus = statusResponse.json.update;
          if (lastStatus.status === "available") {
            availableObserved = true;
            if (!installTriggered) {
              await triggerInstall(baseUrl);
              installTriggered = true;
            }
          }
          if (lastStatus.status === "installing") {
            installingObserved = true;
          }
          if (lastStatus.status === "failed") {
            throw new Error(lastStatus.error || "desktop reported update failure");
          }
        }
      } catch (error) {
        // The server can disappear briefly while the app shuts down for restart.
        if (installingObserved || child.exitCode !== null) {
          await sleep(1000);
          continue;
        }
        throw error;
      }

      await sleep(1000);
    }

    throw new Error(
      `timed out waiting for bundle version ${options.targetVersion}; availableObserved=${availableObserved}; installTriggered=${installTriggered}; last status was ${JSON.stringify(lastStatus)}`,
    );
  } finally {
    terminateProcess(child);
    killBundleProcesses(executablePath);
    stdout.end();
    stderr.end();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
