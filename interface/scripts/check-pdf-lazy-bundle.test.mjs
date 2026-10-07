import assert from "node:assert/strict";
import test from "node:test";
import { checkPdfLazyBundle } from "./check-pdf-lazy-bundle.mjs";

const assets = ["pdf-parser-abc.js", "pdf.worker.min-abc.mjs"];
test("accepts a parser and worker absent from the initial preload graph", () => {
  checkPdfLazyBundle('<script src="/assets/index-abc.js"></script>', assets);
});
test("rejects an eagerly preloaded PDF parser", () => {
  assert.throws(() => checkPdfLazyBundle('<link href="/assets/pdf-parser-abc.js" rel="modulepreload">', assets), /initial HTML/);
});
test("rejects missing parser or worker assets", () => {
  assert.throws(() => checkPdfLazyBundle("", assets.slice(0, 1)), /worker/);
  assert.throws(() => checkPdfLazyBundle("", assets.slice(1)), /parser chunk/);
});
