import {
  getIntegrationDefinition,
  getConnectionAuthHint,
  getConnectionAuthLabel,
  getLocalAuthLabel,
  integrationSections,
} from "./integrationCatalog";

describe("integrationCatalog auth labels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses provider-specific API labels for single-provider runtimes", () => {
    expect(getConnectionAuthLabel("claude_code")).toBe("Anthropic API");
    expect(getConnectionAuthLabel("codex")).toBe("OpenAI API");
    expect(getConnectionAuthLabel("gemini_cli")).toBe("Gemini API");
  });

  it("uses workspace connection wording for multi-provider runtimes", () => {
    expect(getConnectionAuthLabel("opencode")).toBe("Workspace Connection");
    expect(getConnectionAuthHint("opencode")).toContain("Anthropic");
    expect(getConnectionAuthHint("opencode")).toContain("OpenAI");
    expect(getConnectionAuthHint("opencode")).toContain("Gemini");
    expect(getConnectionAuthHint("opencode")).toContain("xAI");
    expect(getConnectionAuthHint("opencode")).toContain("OpenRouter");
  });

  it("keeps local auth labels explicit about the runtime", () => {
    expect(getLocalAuthLabel("claude_code")).toBe("Claude Code CLI");
    expect(getLocalAuthLabel("codex")).toBe("Codex CLI");
    expect(getLocalAuthLabel("opencode")).toBe("OpenCode CLI");
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

  it("defaults settings connections to AURA Proxy when provider selection is off", () => {
    vi.stubEnv("VITE_ENABLE_SETTINGS_PROVIDER_SELECTION", "");

    const connections = integrationSections().find((section) => section.id === "workspace_connection");

    expect(connections?.providers.map((provider) => provider.id)).toEqual(["aura_proxy"]);
    expect(getIntegrationDefinition("aura_proxy")?.kind).toBe("workspace_connection");
  });

  it("shows the full connection provider list when the feature flag is enabled", () => {
    vi.stubEnv("VITE_ENABLE_SETTINGS_PROVIDER_SELECTION", "true");

    const connections = integrationSections().find((section) => section.id === "workspace_connection");
    const connectionIds = new Set(connections?.providers.map((provider) => provider.id));

    expect(connectionIds.has("aura_proxy")).toBe(true);
    expect(connectionIds.has("anthropic")).toBe(true);
    expect(connectionIds.has("openai")).toBe(true);
  });
});
