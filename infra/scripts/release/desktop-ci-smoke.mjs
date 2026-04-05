#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const binaryPath = process.env.AURA_DESKTOP_BINARY;
const port = process.env.AURA_SERVER_PORT || "19847";
const baseUrl = process.env.AURA_DESKTOP_BASE_URL || `http://127.0.0.1:${port}`;
const timeoutMs = Number(process.env.AURA_DESKTOP_SMOKE_TIMEOUT_MS || "120000");
const logDir = process.env.AURA_DESKTOP_SMOKE_LOG_DIR || path.resolve("desktop-smoke-logs");

if (!binaryPath) {
  console.error("AURA_DESKTOP_BINARY is required");
  process.exit(1);
}

fs.mkdirSync(logDir, { recursive: true });
const stdoutPath = path.join(logDir, "desktop.stdout.log");
const stderrPath = path.join(logDir, "desktop.stderr.log");
const stdout = fs.createWriteStream(stdoutPath, { flags: "w" });
const stderr = fs.createWriteStream(stderrPath, { flags: "w" });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-desktop-smoke-"));

const childEnv = {
  ...process.env,
  AURA_DESKTOP_CI: "1",
  AURA_SERVER_PORT: String(port),
  AURA_DATA_DIR: dataDir,
};

const launch = (() => {
  if (process.platform === "linux") {
    return {
      command: "xvfb-run",
      args: ["-a", binaryPath],
    };
  }
  return {
    command: binaryPath,
    args: [],
  };
})();

const child = spawn(launch.command, launch.args, {
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.pipe(stdout);
child.stderr.pipe(stderr);

let shuttingDown = false;

function cleanupAndExit(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  stdout.end();
  stderr.end();
  if (!child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5000).unref();
  }
  process.exit(code);
}

child.on("exit", (code, signal) => {
  if (shuttingDown) return;
  console.error(`desktop process exited early (code=${code}, signal=${signal})`);
  cleanupAndExit(1);
});

async function waitForReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const root = await fetch(baseUrl);
      if (root.ok) {
        const html = await root.text();
        if (!html.includes("<div id=\"root\">") && !html.includes("<div id='root'>")) {
          throw new Error("frontend root marker missing from desktop response");
        }
      } else {
        throw new Error(`root returned ${root.status}`);
      }

      const update = await fetch(`${baseUrl}/api/update-status`);
      if (!update.ok) {
        throw new Error(`/api/update-status returned ${update.status}`);
      }
      const payload = await update.json();
      if (!payload || typeof payload.current_version !== "string" || !payload.current_version) {
        throw new Error("desktop update status payload missing current_version");
      }
      if (!payload.update || typeof payload.update.status !== "string") {
        throw new Error("desktop update status payload missing update state");
      }
      if (typeof payload.endpoint_template !== "string" || !payload.endpoint_template.includes("/{{target}}/{{arch}}.json")) {
        throw new Error("desktop update status payload missing endpoint_template");
      }

      console.log(JSON.stringify({
        ok: true,
        baseUrl,
        currentVersion: payload.current_version,
        updateStatus: payload.update.status,
        channel: payload.channel,
        updateBaseUrl: payload.update_base_url,
        endpointTemplate: payload.endpoint_template,
        logs: { stdout: stdoutPath, stderr: stderrPath },
      }, null, 2));
      cleanupAndExit(0);
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error(`timed out waiting for desktop smoke target at ${baseUrl}`);
  console.error(`stdout: ${stdoutPath}`);
  console.error(`stderr: ${stderrPath}`);
  cleanupAndExit(1);
}

void waitForReady();
