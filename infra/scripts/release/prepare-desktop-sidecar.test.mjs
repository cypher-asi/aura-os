import assert from "node:assert/strict";
import test from "node:test";

import { resolveSidecarPackage } from "./prepare-desktop-sidecar.mjs";

function metadataWithPackage(packageName, targetName = "aura-node") {
  return {
    packages: [
      {
        name: packageName,
        targets: [
          {
            name: targetName,
            kind: ["bin"],
          },
        ],
      },
    ],
  };
}

test("resolves the current aura-runtime package that owns aura-node", () => {
  assert.equal(
    resolveSidecarPackage(metadataWithPackage("aura-runtime"), "aura-node"),
    "aura-runtime",
  );
});

test("resolves renamed aura-node package that owns aura-node", () => {
  assert.equal(
    resolveSidecarPackage(metadataWithPackage("aura-node"), "aura-node"),
    "aura-node",
  );
});

test("rejects ambiguous aura-node binary owners", () => {
  const metadata = {
    packages: [
      ...metadataWithPackage("aura-runtime").packages,
      ...metadataWithPackage("aura-node").packages,
    ],
  };

  assert.throws(
    () => resolveSidecarPackage(metadata, "aura-node"),
    /multiple harness packages expose bin aura-node: aura-runtime, aura-node/,
  );
});
