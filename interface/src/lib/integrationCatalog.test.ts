import {
  getIntegrationDefinition,
  getConnectionAuthHint,
  getConnectionAuthLabel,
  integrationSections,
} from "./integrationCatalog";

describe("integrationCatalog auth labels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses generic workspace connection labels for the aura harness adapter", () => {
    expect(getConnectionAuthLabel("aura_harness")).toBe("Workspace Connection");
    expect(getConnectionAuthHint("aura_harness")).toContain("compatible workspace connection");
  });

  it("falls back to workspace connection wording for unknown adapters", () => {
    expect(getConnectionAuthLabel("legacy_unknown")).toBe("Workspace Connection");
  });

  it("keeps work-app integrations in the Apps section", () => {
    const apps = integrationSections().find((section) => section.id === "workspace_integration");
    const appIds = new Set(apps?.providers.map((provider) => provider.id));

    for (const provider of [
      "github",
      "linear",
      "slack",
      "notion",
      "brave_search",
      "freepik",
      "buffer",
      "apify",
      "metricool",
      "mailchimp",
      "resend",
    ]) {
      expect(getIntegrationDefinition(provider)?.kind).toBe("workspace_integration");
      expect(appIds.has(provider)).toBe(true);
    }
  });

  it("omits AURA Proxy from connections when provider selection is off", () => {
    vi.stubEnv("VITE_ENABLE_SETTINGS_PROVIDER_SELECTION", "");

    const connections = integrationSections().find((section) => section.id === "workspace_connection");
    const connectionIds = new Set(connections?.providers.map((provider) => provider.id));

    expect(connectionIds.has("aura_proxy")).toBe(false);
    expect(connectionIds.has("anthropic")).toBe(false);
    expect(getIntegrationDefinition("aura_proxy")?.kind).toBe("workspace_connection");
  });

  it("shows the connection provider list when the feature flag is enabled", () => {
    vi.stubEnv("VITE_ENABLE_SETTINGS_PROVIDER_SELECTION", "true");

    const connections = integrationSections().find((section) => section.id === "workspace_connection");
    const connectionIds = new Set(connections?.providers.map((provider) => provider.id));

    expect(connectionIds.has("aura_proxy")).toBe(false);
    expect(connectionIds.has("anthropic")).toBe(false);
  });
});
