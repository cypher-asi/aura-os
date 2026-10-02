#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const platforms = [
  { target: "windows", arch: "x86_64", format: "nsis", download: ["windows"], updater: v => `aura-os-desktop_${v}_x64-setup.exe` },
  { target: "linux", arch: "x86_64", format: "appimage", download: ["linux"], updater: v => `aura-os-desktop_${v}_x86_64.AppImage` },
  { target: "macos", arch: "aarch64", format: "app", download: ["mac", "apple-silicon"], updater: v => `aura-os-desktop_${v}_aarch64.app.tar.gz`, installer: v => `AURA_${v}_aarch64.dmg` },
  { target: "macos", arch: "x86_64", format: "app", download: ["mac", "intel"], updater: v => `aura-os-desktop_${v}_x86_64.app.tar.gz`, installer: v => `AURA_${v}_x64.dmg` },
];
const key = p => `${p.target}-${p.arch}`;
const summaryName = p => `release-summary-${key(p)}.json`;
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
function validateReleaseIdentity(channel, version) {
  assert.ok(["nightly", "stable"].includes(channel), "invalid release channel");
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/, "invalid release version");
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validateSummary(dir, platform, channel, version) {
  const summary = readJson(path.join(dir, summaryName(platform)));
  assert.equal(summary.channel, channel, "artifact channel mismatch");
  assert.equal(summary.version, version, "artifact version mismatch");
  assert.ok(summary.artifacts?.length, "empty artifact summary");
  const names = new Set();
  for (const artifact of summary.artifacts) {
    assert.equal(path.basename(artifact.name), artifact.name, "unsafe artifact path");
    assert.ok(!names.has(artifact.name), "duplicate artifact name");
    names.add(artifact.name);
    const file = path.join(dir, artifact.name);
    assert.ok(fs.lstatSync(file).isFile(), "artifact must be a regular file");
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 0, "empty artifact");
    assert.equal(bytes.length, artifact.sizeBytes, "artifact size mismatch");
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), artifact.sha256, "artifact checksum mismatch");
    assert.ok(artifact.name.includes(version), "artifact filename version mismatch");
  }
  for (const name of names) {
    if (name.endsWith(".sig")) assert.ok(names.has(name.slice(0, -4)), "orphan signature");
    else assert.ok(names.has(`${name}.sig`), `missing signature for ${name}`);
  }
  assert.ok(names.has(platform.updater(version)), "missing primary updater artifact");
  assert.ok(names.has((platform.installer ?? platform.updater)(version)), "missing primary installer");
  return summary;
}

export function preparePublication({ input, output, channel, version, report }) {
  validateReleaseIdentity(channel, version);
  assert.ok(!fs.existsSync(output) || fs.readdirSync(output).length === 0, "publication output must be empty");
  const selected = [];
  const copies = [];
  for (const platform of platforms) {
    const dir = path.join(input, `installers-${key(platform)}`);
    if (!fs.existsSync(dir)) continue; // Failed package jobs never upload installers.
    assert.ok(fs.lstatSync(dir).isDirectory(), "installer artifact must be a directory");
    validateSummary(dir, platform, channel, version);
    // Keep the existing per-platform signing/packaging validator mandatory.
    const validation = spawnSync(process.execPath, [
      path.join(import.meta.dirname, "desktop-release-artifacts-validate.mjs"),
      "--dist", dir, "--channel", channel, "--version", version,
      "--target", platform.target, "--arch", platform.arch,
    ], { encoding: "utf8" });
    assert.equal(validation.status, 0, validation.stderr || validation.stdout);
    const summary = readJson(path.join(dir, summaryName(platform)));
    const allowed = new Set([...summary.artifacts.map(a => a.name), summaryName(platform),
      `release-summary-${key(platform)}.md`, `checksums-${key(platform)}.txt`]);
    for (const name of fs.readdirSync(dir)) {
      assert.ok(allowed.has(name), `unexpected release file: ${name}`);
      assert.ok(fs.lstatSync(path.join(dir, name)).isFile(), "release file must not be a symlink or directory");
      assert.ok(!copies.some(c => c.name === name), `colliding release file: ${name}`);
      copies.push({ dir, name });
    }
    selected.push(platform);
  }
  assert.ok(selected.length > 0, "no successful desktop platforms; refusing empty release");
  fs.mkdirSync(output, { recursive: true });
  for (const { dir, name } of copies) fs.copyFileSync(path.join(dir, name), path.join(output, name));
  const available = selected.map(key);
  const unavailable = platforms.filter(p => !available.includes(key(p))).map(key);
  writeJson(path.join(report, "publication.json"), { channel, version, available, unavailable });
  fs.writeFileSync(path.join(report, `artifact-versions-${channel}.md`),
    `# Desktop ${channel} publication\n\n- Version: ${version}\n- Validated platforms: ${available.join(", ")}\n- Unavailable in this release: ${unavailable.join(", ") || "none"}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `available_platforms=${available.join(", ")}\n`);
  return available;
}

export function generateManifests({ input, root, channel, version, repository, tag, report }) {
  validateReleaseIdentity(channel, version);
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  assert.equal(tag, `v${version}`, "release must use its immutable version tag");
  const selected = platforms.filter(p => fs.existsSync(path.join(input, summaryName(p))));
  assert.ok(selected.length > 0, "no successful platforms for manifests");
  // Validate everything before changing any live manifest.
  for (const platform of selected) validateSummary(input, platform, channel, version);
  const downloadsPath = path.join(root, "downloads", `${channel}.json`);
  const previous = fs.existsSync(downloadsPath) ? readJson(downloadsPath) : { desktop: {} };
  assert.ok(!previous.channel || previous.channel === channel, "previous download channel mismatch");
  const desktop = structuredClone(previous.desktop ?? {});
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  for (const platform of selected) {
    const filename = platform.updater(version);
    const signature = fs.readFileSync(path.join(input, `${filename}.sig`), "utf8").trim();
    assert.ok(signature, "missing updater signature");
    writeJson(path.join(root, channel, platform.target, `${platform.arch}.json`), {
      version, url: `${base}/${filename}`, signature, format: platform.format,
    });
    const entry = { url: `${base}/${(platform.installer ?? platform.updater)(version)}`, version };
    if (platform.download.length === 1) desktop[platform.download[0]] = entry;
    else {
      desktop[platform.download[0]] ??= {};
      desktop[platform.download[0]][platform.download[1]] = entry;
    }
  }
  writeJson(downloadsPath, {
    ...previous, channel, version, release_url: `https://github.com/${repository}/releases/tag/${tag}`,
    generated_at: new Date().toISOString(), available_platforms: selected.map(key), desktop,
  });
  fs.mkdirSync(report, { recursive: true });
  fs.writeFileSync(path.join(report, `desktop-downloads-${channel}.md`),
    `# Desktop ${channel} download manifests\n\n- New validated targets: ${selected.map(key).join(", ")}\n- Other platforms retain their previous download and updater manifests, if available.\n`);
  return selected.map(key);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.match(args[i], /^--(input|output|channel|version|report|root|repository|tag)$/);
    assert.ok(args[i + 1], `missing ${args[i]} value`);
    options[args[i].slice(2)] = args[i + 1];
  }
  for (const name of ["input", "channel", "version", "report", ...(command === "prepare" ? ["output"] : ["root", "repository", "tag"])]) {
    assert.ok(options[name], `--${name} is required`);
  }
  assert.ok(["prepare", "manifests"].includes(command), "expected prepare or manifests");
  console.log(JSON.stringify(command === "prepare" ? preparePublication(options) : generateManifests(options)));
}
