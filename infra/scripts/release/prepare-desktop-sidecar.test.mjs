import assert from "node:assert/strict";
import test from "node:test";

import {
  cargoCacheFallbackEnv,
  cargoCacheWrapperEnabled,
  normalizeSccacheWrapperPath,
  resolveSidecarPackage,
} from "./prepare-desktop-sidecar.mjs";

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

test("normalizes Windows sccache wrapper path to executable form", () => {
  assert.equal(
    normalizeSccacheWrapperPath("C:\\hostedtoolcache\\windows\\sccache\\0.15.0\\x64/sccache", "win32"),
    "C:\\hostedtoolcache\\windows\\sccache\\0.15.0\\x64\\sccache.exe",
  );
});

test("leaves non-Windows sccache wrapper path unchanged", () => {
  assert.equal(
    normalizeSccacheWrapperPath("/opt/sccache/sccache", "linux"),
    "/opt/sccache/sccache",
  );
});

test("detects Cargo compiler cache wrapper environment", () => {
  assert.equal(cargoCacheWrapperEnabled({}), false);
  assert.equal(cargoCacheWrapperEnabled({ RUSTC_WRAPPER: "sccache" }), true);
  assert.equal(cargoCacheWrapperEnabled({ CARGO_BUILD_RUSTC_WRAPPER: "sccache" }), true);
});

test("removes Cargo compiler cache wrappers for fallback builds", () => {
  const fallback = cargoCacheFallbackEnv({
    RUSTC_WRAPPER: "sccache",
    CARGO_BUILD_RUSTC_WRAPPER: "sccache",
    SCCACHE_GHA_ENABLED: "true",
    PATH: "/bin",
  });

  assert.deepEqual(fallback, {
    SCCACHE_GHA_ENABLED: "true",
    PATH: "/bin",
  });
});
