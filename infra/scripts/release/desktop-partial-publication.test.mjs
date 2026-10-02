import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { platforms, preparePublication, generateManifests } from "./desktop-partial-publication.mjs";

const version = "0.1.0-nightly.999.1";
const channel = "nightly";
const repository = "cypher-asi/aura-os";
const key = p => `${p.target}-${p.arch}`;
function fixture(t, selected, selectedChannel = channel, selectedVersion = version) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aura-partial-publication-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const input = path.join(temp, "input"), output = path.join(temp, "output"), report = path.join(temp, "report"), root = path.join(temp, "pages");
  fs.mkdirSync(input);
  for (const p of selected) {
    const dir = path.join(input, `installers-${key(p)}`);
    fs.mkdirSync(dir);
    for (const name of new Set([p.updater(selectedVersion), (p.installer ?? p.updater)(selectedVersion)])) {
      fs.writeFileSync(path.join(dir, name), "signed payload");
      fs.writeFileSync(path.join(dir, `${name}.sig`), "updater signature");
    }
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "desktop-release-summary.mjs"), dir, selectedChannel, selectedVersion], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const [a, b] of [["release-summary.json", `release-summary-${key(p)}.json`], ["release-summary.md", `release-summary-${key(p)}.md`], ["checksums.txt", `checksums-${key(p)}.txt`]]) {
      fs.renameSync(path.join(dir, a), path.join(dir, b));
    }
  }
  return { input, output, report, root, channel: selectedChannel, version: selectedVersion, repository, tag: `v${selectedVersion}` };
}

// Exhaust all combinations: failure of any platform must not block its siblings.
for (let mask = 1; mask < 16; mask++) {
  const selected = platforms.filter((_, i) => mask & (1 << i));
  test(`publishes only successful platforms: ${selected.map(key).join(", ")}`, t => {
    const f = fixture(t, selected);
    assert.deepEqual(preparePublication(f), selected.map(key));
    assert.deepEqual(generateManifests({ ...f, input: f.output }), selected.map(key));
    for (const p of platforms) assert.equal(fs.existsSync(path.join(f.root, channel, p.target, `${p.arch}.json`)), selected.includes(p));
    const manifest = JSON.parse(fs.readFileSync(path.join(f.root, "downloads", "nightly.json")));
    assert.deepEqual(manifest.available_platforms, selected.map(key));
  });
}

test("all platforms failed: no empty release or manifests", t => {
  const f = fixture(t, []);
  assert.throws(() => preparePublication(f), /no successful desktop platforms/);
  assert.equal(fs.existsSync(f.output), false);
  assert.throws(() => generateManifests(f), /no successful platforms/);
});

test("partial nightly preserves old Mac download entries and updater files byte-for-byte", t => {
  const f = fixture(t, platforms.slice(0, 2));
  fs.mkdirSync(path.join(f.root, "downloads"), { recursive: true });
  const oldMac = { "apple-silicon": { url: "https://github.com/cypher-asi/aura-os/releases/download/v0.0.9/old-arm.dmg" }, intel: { url: "https://github.com/cypher-asi/aura-os/releases/download/v0.0.9/old-intel.dmg" } };
  fs.writeFileSync(path.join(f.root, "downloads", "nightly.json"), JSON.stringify({ channel, version: "0.0.9", desktop: { mac: oldMac }, mobile: { android: { url: "unchanged" } } }));
  for (const arch of ["aarch64", "x86_64"]) {
    fs.mkdirSync(path.join(f.root, channel, "macos"), { recursive: true });
    fs.writeFileSync(path.join(f.root, channel, "macos", `${arch}.json`), "old Mac manifest bytes\n");
  }
  preparePublication(f);
  generateManifests({ ...f, input: f.output });
  const downloads = JSON.parse(fs.readFileSync(path.join(f.root, "downloads", "nightly.json")));
  assert.deepEqual(downloads.desktop.mac, oldMac);
  assert.deepEqual(downloads.mobile, { android: { url: "unchanged" } });
  for (const arch of ["aarch64", "x86_64"]) assert.equal(fs.readFileSync(path.join(f.root, channel, "macos", `${arch}.json`), "utf8"), "old Mac manifest bytes\n");
  assert.equal(downloads.desktop.windows.version, version);
  assert.match(downloads.desktop.windows.url, /releases\/download\/v0.1.0-nightly.999.1\//);
});

test("stable uses the same partial publication contract", t => {
  const f = fixture(t, [platforms[0]], "stable", "1.2.3");
  preparePublication(f);
  generateManifests({ ...f, input: f.output });
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "stable", "windows", "x86_64.json"))).version, "1.2.3");
});

for (const [name, mutate, pattern] of [
  ["tampered payload", (dir, p) => fs.appendFileSync(path.join(dir, p.updater(version)), "tampered"), /size mismatch/],
  ["missing signature", (dir, p) => fs.unlinkSync(path.join(dir, `${p.updater(version)}.sig`)), /ENOENT/],
  ["unsigned extra file", dir => fs.writeFileSync(path.join(dir, "unvalidated.exe"), "bad"), /does not include version|missing updater signature|unexpected release file/],
  ["wrong summary version", dir => { const file = path.join(dir, "release-summary-windows-x86_64.json"); const summary = JSON.parse(fs.readFileSync(file)); summary.version = "old"; fs.writeFileSync(file, JSON.stringify(summary)); }, /version mismatch/],
  ["wrong channel", dir => { const file = path.join(dir, "release-summary-windows-x86_64.json"); const summary = JSON.parse(fs.readFileSync(file)); summary.channel = "stable"; fs.writeFileSync(file, JSON.stringify(summary)); }, /channel mismatch/],
  ["symlink payload", (dir, p) => { const file = path.join(dir, p.updater(version)); fs.renameSync(file, `${file}.target`); fs.symlinkSync(`${file}.target`, file); }, /regular file/],
]) {
  test(`rejects ${name} before staging publication`, t => {
    const f = fixture(t, [platforms[0]]);
    mutate(path.join(f.input, "installers-windows-x86_64"), platforms[0]);
    assert.throws(() => preparePublication(f), pattern);
    assert.equal(fs.existsSync(f.output), false);
  });
}

test("does not overwrite an existing publication directory", t => {
  const f = fixture(t, [platforms[0]]);
  fs.mkdirSync(f.output);
  fs.writeFileSync(path.join(f.output, "previous"), "keep");
  assert.throws(() => preparePublication(f), /must be empty/);
  assert.equal(fs.readFileSync(path.join(f.output, "previous"), "utf8"), "keep");
});

test("rejects mutable nightly alias before writing manifests", t => {
  const f = fixture(t, [platforms[0]]);
  preparePublication(f);
  assert.throws(() => generateManifests({ ...f, input: f.output, tag: "nightly" }), /immutable version tag/);
  assert.equal(fs.existsSync(f.root), false);
});

test("validates generated updater manifests with the existing validator", t => {
  const f = fixture(t, platforms.slice(0, 2));
  preparePublication(f);
  generateManifests({ ...f, input: f.output });
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "desktop-manifest-validate.mjs"), "--root-dir", f.root, "--channel", channel, "--output-dir", f.report], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

for (const c of ["nightly", "stable"]) {
  test(`${c} workflow permits partial publication without bypassing platform checks`, () => {
    const file = fs.readFileSync(path.join(import.meta.dirname, `../../../.github/workflows/release-${c}.yml`), "utf8");
    const release = file.split("\n  release:\n")[1].split(/\n  [a-z-]+:\n/)[0];
    assert.match(release, /if: \$\{\{ !cancelled\(\) && needs.release-preflight.result == 'success'/);
    assert.match(release, /desktop-partial-publication.mjs prepare/);
    assert.match(release, /path: packaged-artifacts/);
    assert.doesNotMatch(release, /merge-multiple: true/);
    const publish = file.split("\n  publish-manifests:\n")[1];
    assert.match(publish, /needs: \[(resolve-version, )?release\]/);
    assert.match(publish, /needs.release.result == 'success'/);
    assert.match(publish, /desktop-partial-publication.mjs manifests/);
    const packageJob = file.split("\n  package:\n")[1].split(/\n  [a-z-]+:\n/)[0];
    assert.match(packageJob, /fail-fast: false/);
    assert.ok(packageJob.indexOf("Notarize and validate macOS DMG") < packageJob.indexOf("Validate signed release artifacts"));
    assert.ok(packageJob.indexOf("Validate signed release artifacts") < packageJob.indexOf("      - name: Upload artifacts"));
    assert.doesNotMatch(packageJob, /name: (?:Package installer|Notarize and validate macOS DMG|Validate signed release artifacts)\n\s+continue-on-error: true/);
  });
}
