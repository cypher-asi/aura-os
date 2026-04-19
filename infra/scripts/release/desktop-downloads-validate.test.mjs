import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const scriptPath = path.join(import.meta.dirname, "desktop-downloads-validate.mjs");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeArtifact(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), "artifact");
}

function runValidator(manifestPath, artifactsDir, channel) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-downloads-validate-out-"));
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--manifest",
      manifestPath,
      "--artifacts-dir",
      artifactsDir,
      "--channel",
      channel,
      "--output-dir",
      outputDir,
    ],
    { encoding: "utf8" }
  );
  return { ...result, outputDir };
}

function buildNightlyManifest(baseUrl, releaseUrl) {
  return {
    channel: "nightly",
    version: "0.1.0-nightly.291.1",
    release_url: releaseUrl,
    desktop: {
      windows: {
        url: `${baseUrl}/aura-os-desktop_0.1.0-nightly.291.1_x64-setup.exe`,
      },
      mac: {
        "apple-silicon": {
          url: `${baseUrl}/Aura_0.1.0-nightly.291.1_aarch64.dmg`,
        },
        intel: {
          url: `${baseUrl}/Aura_0.1.0-nightly.291.1_x64.dmg`,
        },
      },
      linux: {
        url: `${baseUrl}/aura-os-desktop_0.1.0-nightly.291.1_x86_64.AppImage`,
      },
    },
  };
}

test("nightly download validation rejects mutable nightly release URLs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-downloads-validate-"));
  const artifactsDir = path.join(tempDir, "artifacts");
  const manifestPath = path.join(tempDir, "nightly.json");
  for (const name of [
    "aura-os-desktop_0.1.0-nightly.291.1_x64-setup.exe",
    "Aura_0.1.0-nightly.291.1_aarch64.dmg",
    "Aura_0.1.0-nightly.291.1_x64.dmg",
    "aura-os-desktop_0.1.0-nightly.291.1_x86_64.AppImage",
  ]) {
    writeArtifact(artifactsDir, name);
  }
  writeJson(
    manifestPath,
    buildNightlyManifest(
      "https://github.com/cypher-asi/aura-os/releases/download/nightly",
      "https://github.com/cypher-asi/aura-os/releases/tag/nightly"
    )
  );

  const result = runValidator(manifestPath, artifactsDir, "nightly");
  const summary = fs.readFileSync(path.join(result.outputDir, "desktop-downloads-nightly.md"), "utf8");

  assert.notEqual(result.status, 0);
  assert.match(summary, /nightly release_url must reference an immutable release tag/);
  assert.match(summary, /nightly download URLs must use immutable release asset URLs/);
});

test("nightly download validation accepts immutable release URLs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-downloads-validate-"));
  const artifactsDir = path.join(tempDir, "artifacts");
  const manifestPath = path.join(tempDir, "nightly.json");
  for (const name of [
    "aura-os-desktop_0.1.0-nightly.291.1_x64-setup.exe",
    "Aura_0.1.0-nightly.291.1_aarch64.dmg",
    "Aura_0.1.0-nightly.291.1_x64.dmg",
    "aura-os-desktop_0.1.0-nightly.291.1_x86_64.AppImage",
  ]) {
    writeArtifact(artifactsDir, name);
  }
  writeJson(
    manifestPath,
    buildNightlyManifest(
      "https://github.com/cypher-asi/aura-os/releases/download/v0.1.0-nightly.291.1",
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.291.1"
    )
  );

  const result = runValidator(manifestPath, artifactsDir, "nightly");

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
