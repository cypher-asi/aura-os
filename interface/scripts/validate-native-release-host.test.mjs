import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNativeReleaseHost } from "./validate-native-release-host.mjs";

for (const platform of ["ios", "android"]) {
  test(`${platform} release requires a configured HTTPS origin`, () => {
    for (const host of [undefined, "", "http://10.0.2.2:3100", "api.aura.ai", "https://api.aura.ai/path", "https://user:password@api.aura.ai", "https://api.aura.ai?x=1"]) {
      assert.throws(() => validateNativeReleaseHost(platform, { VITE_NATIVE_DEFAULT_HOST: host }));
    }
    assert.equal(validateNativeReleaseHost(platform, { VITE_NATIVE_DEFAULT_HOST: "https://api.aura.ai/" }), "https://api.aura.ai");
  });
  test(`${platform} override is authoritative, including invalid overrides`, () => {
    const name = `VITE_${platform.toUpperCase()}_DEFAULT_HOST`;
    assert.equal(validateNativeReleaseHost(platform, { VITE_NATIVE_DEFAULT_HOST: "https://api.aura.ai", [name]: "https://staging.example.com" }), "https://staging.example.com");
    assert.throws(() => validateNativeReleaseHost(platform, { VITE_NATIVE_DEFAULT_HOST: "https://api.aura.ai", [name]: "http://localhost:3100" }));
  });
}
