import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function checkPdfLazyBundle(html, assetNames) {
  assert(!/\b(?:src|href)=["'][^"']*pdf-parser/.test(html), "PDF parser must not be in the initial HTML preload graph");
  assert(assetNames.some((name) => /^pdf-parser-.*\.js$/.test(name)), "Missing lazy PDF parser chunk");
  assert(assetNames.some((name) => /^pdf\.worker\.min-.*\.mjs$/.test(name)), "Missing bundled PDF worker");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
  checkPdfLazyBundle(readFileSync(resolve(dist, "index.html"), "utf8"), readdirSync(resolve(dist, "assets")));
  console.log("PDF parser is lazy and its local worker is bundled.");
}
