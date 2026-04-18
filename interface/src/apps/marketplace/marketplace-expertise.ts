import type { ReactNode } from "react";
import {
  Briefcase,
  Code,
  DollarSign,
  FileText,
  Headphones,
  Languages,
  LineChart,
  Megaphone,
  Palette,
  Paintbrush,
  Scale,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Target,
  Terminal,
  Truck,
  UserCog,
} from "lucide-react";

/**
 * Canonical list of expertise categories shown in the Marketplace sidebar and
 * encoded into each Agent's `tags` field as `expertise:<slug>`. Keep this list
 * stable and append-only; ids are part of the public agent tag convention.
 *
 * The server mirrors this list in `aura_os_core::expertise::ALLOWED_SLUGS`
 * (added in Phase 2) so create/update requests can validate unknown slugs.
 */
export const MARKETPLACE_EXPERTISE = [
  { id: "coding", label: "Coding", icon: Code },
  { id: "cyber-security", label: "Cyber Security", icon: ShieldCheck },
  { id: "ui-ux", label: "UI / UX", icon: Palette },
  { id: "design", label: "Design", icon: Paintbrush },
  { id: "strategy", label: "Strategy", icon: Target },
  { id: "accounting", label: "Accounting", icon: DollarSign },
  { id: "legal", label: "Legal", icon: Scale },
  { id: "research", label: "Research", icon: Search },
  { id: "marketing", label: "Marketing", icon: Megaphone },
  { id: "sales", label: "Sales", icon: ShoppingCart },
  { id: "data-analysis", label: "Data Analysis", icon: LineChart },
  { id: "writing", label: "Writing", icon: FileText },
  { id: "social-media", label: "Social Media", icon: Share2 },
  { id: "devops", label: "DevOps", icon: Terminal },
  { id: "ml-ai", label: "ML / AI", icon: Sparkles },
  { id: "product-management", label: "Product Management", icon: Briefcase },
  { id: "operations", label: "Operations", icon: Settings },
  { id: "finance", label: "Finance", icon: DollarSign },
  { id: "customer-support", label: "Customer Support", icon: Headphones },
  { id: "education", label: "Education", icon: UserCog },
  { id: "translation", label: "Translation", icon: Languages },
  { id: "logistics", label: "Logistics", icon: Truck },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
}>;

export type MarketplaceExpertiseSlug = (typeof MARKETPLACE_EXPERTISE)[number]["id"];

export const MARKETPLACE_EXPERTISE_SLUG_SET: ReadonlySet<string> = new Set(
  MARKETPLACE_EXPERTISE.map((e) => e.id),
);

export const EXPERTISE_TAG_PREFIX = "expertise:";

/** Parse expertise slugs out of an Agent's tag vector. */
export function expertiseSlugsFromTags(tags: readonly string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const slugs: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith(EXPERTISE_TAG_PREFIX)) {
      const slug = tag.slice(EXPERTISE_TAG_PREFIX.length);
      if (MARKETPLACE_EXPERTISE_SLUG_SET.has(slug)) {
        slugs.push(slug);
      }
    }
  }
  return slugs;
}

/** Look up the presentational label for an expertise slug, falling back to the slug. */
export function expertiseLabel(slug: string): string {
  const entry = MARKETPLACE_EXPERTISE.find((e) => e.id === slug);
  return entry?.label ?? slug;
}
