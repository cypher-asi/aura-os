#!/usr/bin/env node

import path from "node:path";
import { promises as fs } from "node:fs";

import { captureSeededScreenshots } from "./lib/demo-screenshot-runner.mjs";
import { getDemoScreenshotProfile, listDemoScreenshotProfiles } from "./lib/demo-screenshot-seeds.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  console.log(JSON.stringify({ profiles: listDemoScreenshotProfiles() }, null, 2));
  process.exit(0);
}

const profileId = String(args.profile || "feedback-thread-proof").trim();
const baseUrl = String(args["base-url"] || process.env.AURA_DEMO_SCREENSHOT_BASE_URL || "http://127.0.0.1:5173").trim();
const provider = String(args.provider || "auto").trim();
const outputRoot = path.resolve(
  args["output-dir"] || path.join(process.cwd(), "output", "demo-screenshots"),
);
const runId = `${slugify(profileId)}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}`;
const outputDir = path.join(outputRoot, runId);
await fs.mkdir(outputDir, { recursive: true });

const profile = getDemoScreenshotProfile(profileId);
const manifest = await captureSeededScreenshots({
  profile,
  baseUrl,
  outputDir,
  provider,
});

console.log(JSON.stringify({
  ok: true,
  profileId,
  mode: manifest.mode,
  authMode: manifest.authMode,
  dataMode: manifest.dataMode,
  provider: manifest.provider,
  sessionId: manifest.sessionId,
  inspectorUrl: manifest.inspectorUrl,
  outputDir,
  screenshots: manifest.screenshots,
}, null, 2));
