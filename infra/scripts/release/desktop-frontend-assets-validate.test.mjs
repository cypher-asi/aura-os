#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractAssetRefs,
  findBrokenCssModuleExports,
  validateAnalyticsBakedIn,
} from "./desktop-frontend-assets-validate.mjs";

function makeDist(jsContents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-dist-"));
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "index-abc.js"), jsContents, "utf8");
  return dir;
}

test("extractAssetRefs returns built asset src and href references", () => {
  const html = `
    <link rel="stylesheet" href="/assets/index-abc.css">
    <script type="module" src="/assets/index-def.js"></script>
    <link rel="manifest" href="/manifest.webmanifest">
    <script src="assets/legacy.js?cache=1"></script>
  `;

  assert.deepEqual(extractAssetRefs(html), [
    "assets/index-abc.css",
    "assets/index-def.js",
    "assets/legacy.js",
  ]);
});

test("findBrokenCssModuleExports detects rolldown CSS export stubs", () => {
  const js = `
    import "./rolldown-runtime.js";
    export { github_dark_min_exports as g, ok as o };
  `;

  assert.deepEqual(findBrokenCssModuleExports(js), ["github_dark_min_exports"]);
});

test("validateAnalyticsBakedIn passes when token and version are both inlined", () => {
  const token = "mp_token_1234567890";
  const appVersion = "0.1.0-nightly.640.1";
  const dist = makeDist(`var t="${token}";var v="${appVersion}";console.log(t,v);`);
  const result = validateAnalyticsBakedIn(dist, {
    VITE_MIXPANEL_TOKEN: token,
    APP_VERSION: appVersion,
  });
  assert.deepEqual(result, { appVersion, tokenBaked: true, versionBaked: true });
});

test("validateAnalyticsBakedIn throws when token env is empty", () => {
  const dist = makeDist("var t=\"\";");
  assert.throws(
    () => validateAnalyticsBakedIn(dist, { VITE_MIXPANEL_TOKEN: "", APP_VERSION: "0.1.0" }),
    /VITE_MIXPANEL_TOKEN is empty/,
  );
});

test("validateAnalyticsBakedIn throws when version is the 0.0.0 fallback", () => {
  const token = "mp_token_1234567890";
  const dist = makeDist(`var t="${token}";`);
  assert.throws(
    () => validateAnalyticsBakedIn(dist, { VITE_MIXPANEL_TOKEN: token, APP_VERSION: "0.0.0" }),
    /APP_VERSION must be a real release version/,
  );
});

test("validateAnalyticsBakedIn throws when token did not reach the bundle", () => {
  const dist = makeDist("var t=\"something-else\";");
  assert.throws(
    () =>
      validateAnalyticsBakedIn(dist, {
        VITE_MIXPANEL_TOKEN: "mp_token_1234567890",
        APP_VERSION: "0.1.0",
      }),
    /was not inlined into the built frontend/,
  );
});

test("validateAnalyticsBakedIn throws when version is set but not inlined", () => {
  const token = "mp_token_1234567890";
  const dist = makeDist(`var t="${token}";`);
  assert.throws(
    () =>
      validateAnalyticsBakedIn(dist, {
        VITE_MIXPANEL_TOKEN: token,
        APP_VERSION: "9.9.9-not-in-bundle",
      }),
    /APP_VERSION.*was not inlined/s,
  );
});
