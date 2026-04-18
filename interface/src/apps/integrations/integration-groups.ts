import {
  INTEGRATION_CATALOG,
  type IntegrationDefinition,
} from "../../lib/integrationCatalog";

/**
 * Display groups for the Integrations app left-menu.
 *
 * Each provider from `INTEGRATION_CATALOG` is assigned to exactly one group so
 * the Integrations app's left panel can render collapsible sections
 * (Communication, Productivity, Coding, etc.) instead of the flat
 * workspace-connection / workspace-integration / mcp-server kinds that the
 * Team Settings form uses.
 */
export type IntegrationGroupId =
  | "communication"
  | "productivity"
  | "coding"
  | "social_media"
  | "image_gen"
  | "scraping"
  | "email"
  | "search"
  | "mcp_servers";

export interface IntegrationGroup {
  id: IntegrationGroupId;
  title: string;
  providers: IntegrationDefinition[];
}

const GROUP_ORDER: ReadonlyArray<{ id: IntegrationGroupId; title: string }> = [
  { id: "communication", title: "Communication" },
  { id: "productivity", title: "Productivity" },
  { id: "coding", title: "Coding" },
  { id: "social_media", title: "Social Media" },
  { id: "image_gen", title: "Image Gen" },
  { id: "scraping", title: "Scraping" },
  { id: "email", title: "Email" },
  { id: "search", title: "Search" },
  { id: "mcp_servers", title: "MCP Servers" },
];

// Explicit provider -> group assignment. Keep the 9 groups from the product
// spec at the top so adding a new provider there is a one-line change; the
// long-tail AI model connections and utility integrations fall back to
// sensible defaults below.
const PROVIDER_GROUP: Record<string, IntegrationGroupId> = {
  slack: "communication",
  notion: "productivity",
  linear: "productivity",
  anthropic: "coding",
  openai: "coding",
  google_gemini: "coding",
  xai: "coding",
  openrouter: "coding",
  aura_proxy: "coding",
  github: "coding",
  buffer: "social_media",
  metricool: "social_media",
  freepik: "image_gen",
  apify: "scraping",
  mailchimp: "email",
  resend: "email",
  brave_search: "search",
  mcp_server: "mcp_servers",
};

/** Group that unknown providers fall into so nothing disappears from the UI. */
const DEFAULT_GROUP: IntegrationGroupId = "productivity";

export function getIntegrationGroupId(provider: string): IntegrationGroupId {
  return PROVIDER_GROUP[provider] ?? DEFAULT_GROUP;
}

/**
 * Returns the ordered groups populated with their providers. Groups with no
 * providers are skipped so empty categories don't clutter the left menu.
 */
export function getIntegrationGroups(): IntegrationGroup[] {
  const byGroup = new Map<IntegrationGroupId, IntegrationDefinition[]>();
  for (const definition of INTEGRATION_CATALOG) {
    const groupId = getIntegrationGroupId(definition.id);
    const list = byGroup.get(groupId) ?? [];
    list.push(definition);
    byGroup.set(groupId, list);
  }

  return GROUP_ORDER.flatMap(({ id, title }) => {
    const providers = byGroup.get(id);
    if (!providers || providers.length === 0) return [];
    return [{ id, title, providers }];
  });
}
