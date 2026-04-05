import type { OrgIntegration } from "../types";

export type IntegrationKind =
  | "workspace_connection"
  | "workspace_integration"
  | "mcp_server";

export interface IntegrationConfigField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
}

export interface IntegrationDefinition {
  id: string;
  label: string;
  kind: IntegrationKind;
  description: string;
  secretLabel: string;
  secretPlaceholder: string;
  authHint?: string;
  docsUrl?: string;
  supportsDefaultModel: boolean;
  runtimeCompatibleAdapters: string[];
  configFields?: IntegrationConfigField[];
}

export const MODEL_RUNTIME_ADAPTERS = [
  "aura_harness",
  "claude_code",
  "codex",
  "gemini_cli",
  "opencode",
  "cursor",
] as const;

export const INTEGRATION_CATALOG: IntegrationDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "workspace_connection",
    description: "Workspace-level Anthropic credentials for Aura, Claude Code, and multi-provider runtimes.",
    secretLabel: "Anthropic API Key",
    secretPlaceholder: "Paste the Anthropic API key",
    authHint: "Use a shared Anthropic key when the workspace should provide Claude access.",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["aura_harness", "claude_code", "opencode"],
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "workspace_connection",
    description: "Workspace-level OpenAI credentials for Codex and multi-provider runtimes.",
    secretLabel: "OpenAI API Key",
    secretPlaceholder: "Paste the OpenAI API key",
    authHint: "Use a workspace OpenAI key when Codex or a multi-provider runtime should inherit it.",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["codex", "opencode"],
  },
  {
    id: "google_gemini",
    label: "Google Gemini",
    kind: "workspace_connection",
    description: "Workspace-level Gemini credentials for Gemini CLI and multi-provider runtimes.",
    secretLabel: "Gemini API Key",
    secretPlaceholder: "Paste the Gemini API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["gemini_cli", "opencode"],
  },
  {
    id: "xai",
    label: "xAI",
    kind: "workspace_connection",
    description: "Workspace-level Grok access for multi-provider runtimes.",
    secretLabel: "xAI API Key",
    secretPlaceholder: "Paste the xAI API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["opencode"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "workspace_connection",
    description: "Workspace-level model routing for open-weight and mixed-provider runtime execution.",
    secretLabel: "OpenRouter API Key",
    secretPlaceholder: "Paste the OpenRouter API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["opencode"],
  },
  {
    id: "github",
    label: "GitHub",
    kind: "workspace_integration",
    description: "Repository, issue, and pull request workflows for the workspace.",
    secretLabel: "GitHub Token",
    secretPlaceholder: "Paste the GitHub token",
    authHint: "Use a fine-grained PAT or app token with the repo scopes your workspace needs.",
    docsUrl: "https://docs.github.com/en/rest/authentication",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "linear",
    label: "Linear",
    kind: "workspace_integration",
    description: "Planning, issue tracking, and sprint workflows for the workspace.",
    secretLabel: "Linear API Key",
    secretPlaceholder: "Paste the Linear API key",
    authHint: "Use a Linear API key or OAuth token with the teams and workflows your workspace needs.",
    docsUrl: "https://linear.app/developers/graphql",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "slack",
    label: "Slack",
    kind: "workspace_integration",
    description: "Messaging, channel access, and workspace coordination workflows.",
    secretLabel: "Slack Bot Token",
    secretPlaceholder: "Paste the Slack bot token",
    authHint: "Use a bot token with only the channels and posting scopes your workspace needs.",
    docsUrl: "https://docs.slack.dev/authentication/tokens/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "notion",
    label: "Notion",
    kind: "workspace_integration",
    description: "Docs, notes, and knowledge-base workflows for the workspace.",
    secretLabel: "Notion Integration Secret",
    secretPlaceholder: "Paste the Notion secret",
    authHint: "Use an internal integration secret with access to the pages and databases your workspace needs.",
    docsUrl: "https://developers.notion.com/docs/authorization",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "mcp_server",
    label: "Custom MCP Server",
    kind: "mcp_server",
    description: "Attach a custom MCP server so its tools can be registered into the workspace tool surface.",
    secretLabel: "Optional MCP Token",
    secretPlaceholder: "Optional bearer token or API key",
    authHint: "Use URL for remote HTTP MCP or command/args for stdio MCP. Save a token only when the server requires one.",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
    configFields: [
      {
        key: "transport",
        label: "Transport",
        placeholder: "http or stdio",
        required: true,
      },
      {
        key: "url",
        label: "Server URL",
        placeholder: "https://example.com/mcp",
      },
      {
        key: "command",
        label: "Command",
        placeholder: "npx",
      },
      {
        key: "args",
        label: "Args",
        placeholder: "-y @modelcontextprotocol/server-github",
      },
    ],
  },
];

export function getIntegrationDefinition(provider: string): IntegrationDefinition | undefined {
  return INTEGRATION_CATALOG.find((definition) => definition.id === provider);
}

export function getIntegrationLabel(provider: string): string {
  return getIntegrationDefinition(provider)?.label ?? provider;
}

export function getSecretLabel(provider: string): string {
  return getIntegrationDefinition(provider)?.secretLabel ?? "Provider Secret";
}

export function getSecretPlaceholder(provider: string): string {
  return getIntegrationDefinition(provider)?.secretPlaceholder ?? "Paste the provider secret";
}

export function getIntegrationSurfaceLabel(provider: string): string {
  const kind = getIntegrationDefinition(provider)?.kind;
  if (kind === "workspace_connection") {
    return "Workspace connection for model/runtime access.";
  }
  if (kind === "workspace_integration") {
    return "Workspace integration for external tools and workflows.";
  }
  if (kind === "mcp_server") {
    return "MCP server source whose tools can be registered into the workspace tool surface.";
  }
  return "Workspace-level capability.";
}

export function getIntegrationKind(provider: string): IntegrationKind {
  return getIntegrationDefinition(provider)?.kind ?? "workspace_connection";
}

export function getIntegrationConfigFields(provider: string): IntegrationConfigField[] {
  return getIntegrationDefinition(provider)?.configFields ?? [];
}

export function supportsDefaultModel(provider: string): boolean {
  return getIntegrationDefinition(provider)?.supportsDefaultModel ?? false;
}

export function runtimeAuthProvidersForAdapter(adapterType: string): string[] {
  return INTEGRATION_CATALOG
    .filter((definition) => definition.runtimeCompatibleAdapters.includes(adapterType))
    .map((definition) => definition.id);
}

export function supportsOrgIntegrationAuth(adapterType: string): boolean {
  return runtimeAuthProvidersForAdapter(adapterType).length > 0;
}

export function supportsLocalCliAuth(adapterType: string): boolean {
  return adapterType !== "aura_harness";
}

export function filterRuntimeCompatibleIntegrations(
  adapterType: string,
  integrations: OrgIntegration[],
): OrgIntegration[] {
  const requiredProviders = new Set(runtimeAuthProvidersForAdapter(adapterType));
  if (requiredProviders.size === 0) return [];
  return integrations.filter(
    (integration) =>
      integration.kind === "workspace_connection" && requiredProviders.has(integration.provider),
  );
}

export function integrationSections(): Array<{
  id: IntegrationKind;
  title: string;
  description: string;
  providers: IntegrationDefinition[];
}> {
  return [
    {
      id: "workspace_connection",
      title: "Workspace Connections",
      description: "Shared model-provider access that adapters can use at runtime.",
      providers: INTEGRATION_CATALOG.filter((provider) => provider.kind === "workspace_connection"),
    },
    {
      id: "workspace_integration",
      title: "Workspace Integrations",
      description: "External systems that can contribute tools and workflows into Aura OS.",
      providers: INTEGRATION_CATALOG.filter((provider) => provider.kind === "workspace_integration"),
    },
    {
      id: "mcp_server",
      title: "MCP Servers",
      description: "Additional tool sources that expose their own tool surface through MCP.",
      providers: INTEGRATION_CATALOG.filter((provider) => provider.kind === "mcp_server"),
    },
  ];
}
