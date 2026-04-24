import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("high-resolution capture stays generic and does not encode feature-specific routes", () => {
  const sourcePath = path.join(import.meta.dirname, "changelog-media-highres-capture.mjs");
  const source = fs.readFileSync(sourcePath, "utf8");

  assert.doesNotMatch(source, /GPT-5\.5|open-model-picker|model-picker|feedback-composer|agent-editor/);
  assert.match(source, /\[data-agent-surface\]/);
  assert.match(source, /\[data-agent-action\]/);
});
