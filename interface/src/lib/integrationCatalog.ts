import type { OrgIntegration } from "../types";

export type IntegrationKind = "model" | "tool";

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
}

export const INTEGRATION_CATALOG: IntegrationDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "model",
    description: "Claude models for Aura and Claude Code runtime execution.",
    secretLabel: "Anthropic API Key",
    secretPlaceholder: "Paste the Anthropic API key",
    authHint: "Use an org-owned Anthropic API key for shared BYOK execution.",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["aura_harness", "claude_code"],
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "model",
    description: "OpenAI-backed models and API credentials for Codex-style execution.",
    secretLabel: "OpenAI API Key",
    secretPlaceholder: "Paste the OpenAI API key",
    authHint: "Use an OpenAI platform API key for Codex-style team execution.",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: ["codex"],
  },
  {
    id: "google_gemini",
    label: "Google Gemini",
    kind: "model",
    description: "Gemini model access for future runtime support and shared org setup.",
    secretLabel: "Gemini API Key",
    secretPlaceholder: "Paste the Gemini API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "xai",
    label: "xAI",
    kind: "model",
    description: "Grok model access for future runtime support.",
    secretLabel: "xAI API Key",
    secretPlaceholder: "Paste the xAI API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "groq",
    label: "Groq",
    kind: "model",
    description: "Fast hosted inference with a shared org-level key.",
    secretLabel: "Groq API Key",
    secretPlaceholder: "Paste the Groq API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "model",
    description: "Aggregator access to multiple model vendors through one integration.",
    secretLabel: "OpenRouter API Key",
    secretPlaceholder: "Paste the OpenRouter API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "together",
    label: "Together AI",
    kind: "model",
    description: "Hosted open-weight model access for future runtime support.",
    secretLabel: "Together API Key",
    secretPlaceholder: "Paste the Together API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "model",
    description: "Mistral-hosted model access for future runtime support.",
    secretLabel: "Mistral API Key",
    secretPlaceholder: "Paste the Mistral API key",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    kind: "model",
    description: "Perplexity-hosted model and search-backed answer access for future runtime support.",
    secretLabel: "Perplexity API Key",
    secretPlaceholder: "Paste the Perplexity API key",
    authHint: "Store a Perplexity API key for future research-oriented runtime use.",
    supportsDefaultModel: true,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "github",
    label: "GitHub",
    kind: "tool",
    description: "Repository, PR, issue, and automation access across org projects.",
    secretLabel: "GitHub Token",
    secretPlaceholder: "Paste the GitHub token",
    authHint: "GitHub recommends authenticating API requests with a fine-grained PAT or app installation token.",
    docsUrl: "https://docs.github.com/en/rest/authentication",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "gitlab",
    label: "GitLab",
    kind: "tool",
    description: "Repository, merge request, and issue access for teams using GitLab.",
    secretLabel: "GitLab Token",
    secretPlaceholder: "Paste the GitLab token",
    authHint: "Use a project, group, or personal access token with the scopes your workflows need.",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "linear",
    label: "Linear",
    kind: "tool",
    description: "Task tracking and sprint operations at the org level.",
    secretLabel: "Linear API Key",
    secretPlaceholder: "Paste the Linear API key",
    authHint: "Linear uses personal API keys or OAuth2; API requests authenticate with the API key in the Authorization header.",
    docsUrl: "https://linear.app/developers/graphql",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "jira",
    label: "Jira",
    kind: "tool",
    description: "Project tracking, issue workflows, and enterprise sprint operations.",
    secretLabel: "Jira API Token",
    secretPlaceholder: "Paste the Jira API token",
    authHint: "For Jira Cloud, use an Atlassian API token with scopes for the target site.",
    docsUrl: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "confluence",
    label: "Confluence",
    kind: "tool",
    description: "Shared docs, runbooks, and knowledge workflows for project context.",
    secretLabel: "Confluence API Token",
    secretPlaceholder: "Paste the Confluence API token",
    authHint: "For Confluence Cloud, use an Atlassian API token with scopes for the target site.",
    docsUrl: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "brave_search",
    label: "Brave Search",
    kind: "tool",
    description: "Web search and research access for shared team workflows.",
    secretLabel: "Brave Search API Key",
    secretPlaceholder: "Paste the Brave Search API key",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "apify",
    label: "Apify",
    kind: "tool",
    description: "Web scraping and automation jobs using a shared org token.",
    secretLabel: "Apify API Token",
    secretPlaceholder: "Paste the Apify API token",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    kind: "tool",
    description: "Structured crawling and page extraction for research-heavy workflows.",
    secretLabel: "Firecrawl API Key",
    secretPlaceholder: "Paste the Firecrawl API key",
    authHint: "Use a Firecrawl API key for crawling and extraction workloads.",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "exa",
    label: "Exa",
    kind: "tool",
    description: "Search and research retrieval tuned for agent workflows.",
    secretLabel: "Exa API Key",
    secretPlaceholder: "Paste the Exa API key",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "tavily",
    label: "Tavily",
    kind: "tool",
    description: "Agent-native search and retrieval for web research tasks.",
    secretLabel: "Tavily API Key",
    secretPlaceholder: "Paste the Tavily API key",
    authHint: "Store a Tavily API key for research and retrieval-heavy workflows.",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "buffer",
    label: "Buffer",
    kind: "tool",
    description: "Publishing and scheduling workflows for social channels.",
    secretLabel: "Buffer Access Token",
    secretPlaceholder: "Paste the Buffer access token",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "metricool",
    label: "Metricool",
    kind: "tool",
    description: "Cross-channel social analytics and reporting access.",
    secretLabel: "Metricool API Token",
    secretPlaceholder: "Paste the Metricool API token",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "mailchimp",
    label: "Mailchimp",
    kind: "tool",
    description: "Audience, campaign, and email marketing operations.",
    secretLabel: "Mailchimp API Key",
    secretPlaceholder: "Paste the Mailchimp API key",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "hubspot",
    label: "HubSpot",
    kind: "tool",
    description: "CRM, lifecycle, and marketing automation workflows at the org level.",
    secretLabel: "HubSpot Access Token",
    secretPlaceholder: "Paste the HubSpot access token",
    authHint: "Use a private app access token scoped to the CRM and automation actions you need.",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "freepik",
    label: "Freepik",
    kind: "tool",
    description: "Image and creative-generation asset access for content workflows.",
    secretLabel: "Freepik API Key",
    secretPlaceholder: "Paste the Freepik API key",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "slack",
    label: "Slack",
    kind: "tool",
    description: "Shared workspace messaging and notification workflows.",
    secretLabel: "Slack Bot Token",
    secretPlaceholder: "Paste the Slack bot token",
    authHint: "Slack bot tokens usually start with xoxb- and are the best default for workspace automation.",
    docsUrl: "https://docs.slack.dev/authentication/tokens/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "discord",
    label: "Discord",
    kind: "tool",
    description: "Community, support, and notification workflows for Discord servers.",
    secretLabel: "Discord Bot Token",
    secretPlaceholder: "Paste the Discord bot token",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "notion",
    label: "Notion",
    kind: "tool",
    description: "Docs, knowledge base, and workspace data access.",
    secretLabel: "Notion Integration Token",
    secretPlaceholder: "Paste the Notion integration token",
    authHint: "Use a Notion integration access token and treat its token format as opaque.",
    docsUrl: "https://developers.notion.com/guides/get-started/authorization",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "google_drive",
    label: "Google Drive",
    kind: "tool",
    description: "Shared file, doc, and workspace asset access across the org.",
    secretLabel: "Google Workspace Token",
    secretPlaceholder: "Paste the Google Workspace token",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "gmail",
    label: "Gmail",
    kind: "tool",
    description: "Inbox, email triage, and outbound workflow automation.",
    secretLabel: "Gmail Access Token",
    secretPlaceholder: "Paste the Gmail access token",
    authHint: "Prefer OAuth access for mailbox workflows instead of long-lived shared passwords.",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "figma",
    label: "Figma",
    kind: "tool",
    description: "Design files, handoff context, and product iteration workflows.",
    secretLabel: "Figma Personal Access Token",
    secretPlaceholder: "Paste the Figma personal access token",
    authHint: "Figma personal access tokens are sent in the X-Figma-Token header and should be scoped tightly.",
    docsUrl: "https://developers.figma.com/docs/rest-api/authentication/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "sentry",
    label: "Sentry",
    kind: "tool",
    description: "Production error and issue monitoring for developer workflows.",
    secretLabel: "Sentry Auth Token",
    secretPlaceholder: "Paste the Sentry auth token",
    authHint: "Sentry recommends org-level auth tokens from an internal integration when possible.",
    docsUrl: "https://docs.sentry.io/api/guides/create-auth-token/",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
  {
    id: "resend",
    label: "Resend",
    kind: "tool",
    description: "Transactional email delivery workflows and outbound automation.",
    secretLabel: "Resend API Key",
    secretPlaceholder: "Paste the Resend API key",
    supportsDefaultModel: false,
    runtimeCompatibleAdapters: [],
  },
];

const CATALOG_BY_ID = new Map(INTEGRATION_CATALOG.map((definition) => [definition.id, definition]));

export function getIntegrationDefinition(provider: string): IntegrationDefinition | undefined {
  return CATALOG_BY_ID.get(provider);
}

export function getIntegrationLabel(provider: string): string {
  return getIntegrationDefinition(provider)?.label ?? provider;
}

export function getSecretLabel(provider: string): string {
  return getIntegrationDefinition(provider)?.secretLabel ?? "Provider API Key";
}

export function getSecretPlaceholder(provider: string): string {
  return getIntegrationDefinition(provider)?.secretPlaceholder ?? "Paste the provider API key";
}

export function supportsDefaultModel(provider: string): boolean {
  return getIntegrationDefinition(provider)?.supportsDefaultModel ?? true;
}

export function runtimeAuthProviderForAdapter(adapterType: string): string | null {
  if (adapterType === "aura_harness") return "anthropic";
  if (adapterType === "claude_code") return "anthropic";
  if (adapterType === "codex") return "openai";
  return null;
}

export function filterRuntimeCompatibleIntegrations(
  adapterType: string,
  integrations: OrgIntegration[],
): OrgIntegration[] {
  const requiredProvider = runtimeAuthProviderForAdapter(adapterType);
  if (!requiredProvider) return [];
  return integrations.filter((integration) => integration.provider === requiredProvider);
}

export function integrationSections(): Array<{
  id: IntegrationKind;
  title: string;
  description: string;
  providers: IntegrationDefinition[];
}> {
  return [
    {
      id: "model",
      title: "Model Integrations",
      description: "Shared API credentials for model vendors and runtime BYOK paths.",
      providers: INTEGRATION_CATALOG.filter((provider) => provider.kind === "model"),
    },
    {
      id: "tool",
      title: "Tool Integrations",
      description: "Shared org credentials for task systems, search, content, and workflow tools.",
      providers: INTEGRATION_CATALOG.filter((provider) => provider.kind === "tool"),
    },
  ];
}
