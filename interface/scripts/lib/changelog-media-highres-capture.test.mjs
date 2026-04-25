import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("high-resolution capture stays generic and does not encode feature-specific routes", () => {
  const sourcePath = path.join(import.meta.dirname, "changelog-media-highres-capture.mjs");
  const source = fs.readFileSync(sourcePath, "utf8");

  assert.doesNotMatch(source, /GPT-5\.5|open-model-picker|model-picker|feedback-composer|agent-editor/);
  assert.match(source, /\[data-agent-surface\]/);
  assert.match(source, /\[data-agent-context\]/);
  assert.match(source, /\[data-agent-context-anchor\]/);
  assert.match(source, /\[data-agent-action\]/);
  assert.match(source, /proof plus recognizable product context/);
  assert.match(source, /DEFAULT_CHANGELOG_CAPTURE_ZOOM/);
  assert.match(source, /DEFAULT_CHANGELOG_CAPTURE_TEXT_SCALE/);
  assert.match(source, /data-aura-changelog-capture-zoom/);
  assert.match(source, /data-aura-changelog-capture-text-scale/);
  assert.match(source, /contextCreatesMostlyEmptyFrame/);
  assert.match(source, /isFloatingProofElement/);
  assert.match(source, /contextIsUsefulForProof/);
  assert.match(source, /floatingProofFitsTightFrame/);
  assert.match(source, /proofIsCompactTeaser/);
  assert.match(source, /nearbyAnchors/);
  assert.match(source, /min-width: min\(72vw, 900px\)/);
  assert.match(source, /max-height: min\(68vh, 900px\)/);
  assert.doesNotMatch(source, /font-size: calc/);
  assert.doesNotMatch(source, /width: calc\(.*--aura-changelog-capture-text-scale/);
});
