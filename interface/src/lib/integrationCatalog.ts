import type { OrgIntegration } from "../shared/types";

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

export const MODEL_RUNTIME_ADAPTERS = ["aura_harness"] as const;

export const INTEGRATION_CATALOG: IntegrationDefinition[] = [
  {
    id: "aura_proxy",
    label: "AURA Proxy",
    kind: "workspace_connection",
    description: "Workspace-level Aura proxy access for managed model and runtime requests.",
    secretLabel: "AURA Proxy API Key",
    secretPlaceholder: "Paste the AURA Proxy API key",
    authHint: "Use a shared AURA Proxy key when the workspace should route requests through Aura.",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
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
    id: "brave_search",
    label: "Brave Search",
    kind: "workspace_integration",
    description: "Web search, research, and competitive-intelligence workflows for the workspace.",
    secretLabel: "Brave Search API Key",
    secretPlaceholder: "Paste the Brave Search API key",
    authHint: "Use a Brave Search API key when the workspace should access Brave-powered web search tools.",
    docsUrl: "https://api-dashboard.search.brave.com/app/documentation",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "freepik",
    label: "Freepik",
    kind: "workspace_integration",
    description: "AI image and video generation workflows for creative content production.",
    secretLabel: "Freepik API Key",
    secretPlaceholder: "Paste the Freepik API key",
    authHint: "Use a Freepik API key with access to the image or video generation endpoints your workspace needs.",
    docsUrl: "https://docs.freepik.com/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "buffer",
    label: "Buffer",
    kind: "workspace_integration",
    description: "Social scheduling and publishing workflows across connected channels.",
    secretLabel: "Buffer Access Token",
    secretPlaceholder: "Paste the Buffer access token",
    authHint: "Use a Buffer access token for the connected social accounts your workspace is allowed to publish to.",
    docsUrl: "https://buffer.com/developers/api",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "apify",
    label: "Apify",
    kind: "workspace_integration",
    description: "Web scraping, data extraction, and browser automation workflows.",
    secretLabel: "Apify API Token",
    secretPlaceholder: "Paste the Apify API token",
    authHint: "Use an Apify API token when the workspace should run Actors, scraping jobs, or structured extraction tasks.",
    docsUrl: "https://docs.apify.com/api/v2",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "metricool",
    label: "Metricool",
    kind: "workspace_integration",
    description: "Social analytics, campaign reporting, and cross-channel performance workflows.",
    secretLabel: "Metricool API Token",
    secretPlaceholder: "Paste the Metricool API token",
    authHint: "Use a Metricool token with access to the brands and channels your workspace should analyze.",
    docsUrl: "https://developers.metricool.com/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
    configFields: [
      {
        key: "userId",
        label: "User ID",
        placeholder: "1234567",
        required: true,
      },
      {
        key: "blogId",
        label: "Brand ID",
        placeholder: "1234567",
        required: true,
      },
    ],
  },
  {
    id: "mailchimp",
    label: "Mailchimp",
    kind: "workspace_integration",
    description: "Audience, campaign, and email marketing workflows for player communications.",
    secretLabel: "Mailchimp API Key",
    secretPlaceholder: "Paste the Mailchimp API key",
    authHint: "Use a Mailchimp API key with access to the audiences and campaigns your workspace should manage.",
    docsUrl: "https://mailchimp.com/developer/marketing/api/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
    configFields: [
      {
        key: "serverPrefix",
        label: "Server Prefix",
        placeholder: "us19",
      },
    ],
  },
  {
    id: "resend",
    label: "Resend",
    kind: "workspace_integration",
    description: "Transactional email and sending-domain workflows for workspace notifications and outreach.",
    secretLabel: "Resend API Key",
    secretPlaceholder: "Paste the Resend API key",
    authHint: "Use a Resend API key with access to the domains and email flows your workspace should send from.",
    docsUrl: "https://resend.com/docs/api-reference/emails/send-email",
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
      {
        key: "secretEnvVar",
        label: "Secret Env Var",
        placeholder: "GITHUB_PERSONAL_ACCESS_TOKEN",
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAdapterLabel(_adapterType: string): string {
  // External CLI adapters are no longer supported. The argument is kept so
  // call sites can pass through whatever `adapter_type` they have without
  // branching, but the label is constant.
  return "Aura";
}

export function getConnectionAuthLabel(adapterType: string): string {
  const providers = runtimeAuthProvidersForAdapter(adapterType);
  if (providers.length === 1) {
    const label = getIntegrationLabel(providers[0]);
    return `${label} API`;
  }
  return "Workspace Connection";
}

function formatProviderAuthLabel(provider: string): string {
  return getIntegrationLabel(provider);
}

export function getConnectionAuthHint(adapterType: string): string {
  const providers = runtimeAuthProvidersForAdapter(adapterType);
  if (providers.length === 0) {
    return "Use a compatible workspace connection from Connections.";
  }
  if (providers.length === 1) {
    return `Uses a shared ${formatProviderAuthLabel(providers[0])} connection from Connections.`;
  }

  const labels = providers.map(formatProviderAuthLabel);
  return `Choose a shared connection from Connections. Supported providers: ${labels.join(", ")}.`;
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
  const workspaceConnectionProviders = INTEGRATION_CATALOG.filter(
    (provider) => provider.kind === "workspace_connection" && provider.id !== "aura_proxy",
  );

  return [
    {
      id: "workspace_connection",
      title: "Connections",
      description: "Shared Aura runtime connections.",
      providers: workspaceConnectionProviders,
    },
    {
      id: "workspace_integration",
      title: "Apps",
      description: "Connected work apps that can supply tools and workflows.",
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
