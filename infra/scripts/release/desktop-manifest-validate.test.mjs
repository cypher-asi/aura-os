import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const scriptPath = path.join(import.meta.dirname, "desktop-manifest-validate.mjs");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runValidator(rootDir, channel) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-manifest-validate-out-"));
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--root-dir", rootDir, "--channel", channel, "--output-dir", outputDir],
    { encoding: "utf8" }
  );
  return { ...result, outputDir };
}

test("nightly manifest validation rejects mutable nightly release URLs", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-manifest-validate-"));
  writeJson(path.join(rootDir, "nightly", "linux", "x86_64.json"), {
    version: "0.1.0-nightly.291.1",
    url: "https://github.com/cypher-asi/aura-os/releases/download/nightly/aura-os-desktop_0.1.0-nightly.291.1_x86_64.AppImage",
    signature: "signature",
    format: "appimage",
  });

  const result = runValidator(rootDir, "nightly");
  const summary = fs.readFileSync(path.join(result.outputDir, "desktop-manifests-nightly.md"), "utf8");

  assert.notEqual(result.status, 0);
  assert.match(summary, /nightly manifests must use immutable release asset URLs/);
});

test("nightly manifest validation accepts immutable release URLs", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-manifest-validate-"));
  writeJson(path.join(rootDir, "nightly", "linux", "x86_64.json"), {
    version: "0.1.0-nightly.291.1",
    url: "https://github.com/cypher-asi/aura-os/releases/download/v0.1.0-nightly.291.1/aura-os-desktop_0.1.0-nightly.291.1_x86_64.AppImage",
    signature: "signature",
    format: "appimage",
  });

  const result = runValidator(rootDir, "nightly");

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
