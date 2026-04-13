import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrivacyPolicyUrl, getSupportUrl } from "./app-links";

describe("app-links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns configured https urls", () => {
    vi.stubEnv("VITE_PRIVACY_POLICY_URL", "https://example.com/privacy");
    vi.stubEnv("VITE_SUPPORT_URL", "https://example.com/support");

    expect(getPrivacyPolicyUrl()).toBe("https://example.com/privacy");
    expect(getSupportUrl()).toBe("https://example.com/support");
  });

  it("accepts mailto support links", () => {
    vi.stubEnv("VITE_SUPPORT_URL", "mailto:support@example.com");

    expect(getSupportUrl()).toBe("mailto:support@example.com");
  });

  it("rejects unsupported protocols", () => {
    vi.stubEnv("VITE_PRIVACY_POLICY_URL", "javascript:alert(1)");

    expect(getPrivacyPolicyUrl()).toBeNull();
  });

  it("returns null when unset", () => {
    expect(getPrivacyPolicyUrl()).toBeNull();
    expect(getSupportUrl()).toBeNull();
  });
});
