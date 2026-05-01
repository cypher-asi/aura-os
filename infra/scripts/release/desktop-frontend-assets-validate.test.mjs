#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import { extractAssetRefs } from "./desktop-frontend-assets-validate.mjs";

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
