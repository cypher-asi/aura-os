import {
  CalendarCheck,
  CalendarDays,
  Coffee,
  FileText,
  GitBranch,
  Hash,
  Inbox,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Search,
  Send,
  Share2,
} from "lucide-react";
import { PERSONAS } from "../personas";
import catalogData from "../../../data/skill-shop-catalog.json";

/**
 * Curated, self-contained data backing the agent onboarding wizard. We
 * deliberately avoid importing from `apps/*` (per the repo React rules);
 * canonical sources are referenced in comments instead:
 *   - expertise slugs mirror `apps/marketplace/marketplace-expertise.ts`
 *   - skill source URLs are resolved from `data/skill-shop-catalog.json`
 *   - messaging statuses mirror `apps/agents/.../MessagingTab`
 */

// ── Avatars ───────────────────────────────────────────────────────────────

export interface OnboardingAvatar {
  readonly id: string;
  readonly label: string;
  /** Value applied to `agent.icon` (image URL or data URI). */
  readonly icon: string;
}

function gradientAvatar(id: string, label: string, from: string, to: string): OnboardingAvatar {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/></svg>`;
  return { id, label, icon: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

/**
 * 12 default avatars: the 7 curated persona portraits (`interface/public/personas/`)
 * plus 5 gradient tiles so visitors always have a full grid even before uploading.
 */
export const ONBOARDING_AVATARS: readonly OnboardingAvatar[] = [
  ...PERSONAS.map((p) => ({
    id: p.id,
    label: p.name,
    icon: p.theme.desktopBackgroundUrl ?? "",
  })).filter((a) => a.icon !== ""),
  gradientAvatar("aurora", "Aurora", "#7c3aed", "#2dd4bf"),
  gradientAvatar("ember", "Ember", "#f97316", "#db2777"),
  gradientAvatar("tide", "Tide", "#0ea5e9", "#6366f1"),
  gradientAvatar("moss", "Moss", "#22c55e", "#0d9488"),
  gradientAvatar("dusk", "Dusk", "#6366f1", "#0f172a"),
];

// ── Personalities ───────────────────────────────────────────────────────────

export interface PersonalityPreset {
  readonly id: string;
  readonly name: string;
  /** Applied verbatim to `agent.personality`. */
  readonly description: string;
}

export const PERSONALITY_PRESETS: readonly PersonalityPreset[] = [
  { id: "operator", name: "Focused Operator", description: "Direct, efficient, and outcome-driven. Cuts to the point and keeps work moving." },
  { id: "collaborator", name: "Warm Collaborator", description: "Friendly, encouraging, and patient. Explains its thinking and checks in often." },
  { id: "analyst", name: "Sharp Analyst", description: "Precise, evidence-led, and skeptical. Backs claims with data and flags assumptions." },
  { id: "creative", name: "Creative Spark", description: "Playful, imaginative, and bold. Offers unexpected angles and fresh ideas." },
  { id: "strategist", name: "Calm Strategist", description: "Measured, big-picture, and steady. Weighs trade-offs before acting." },
  { id: "researcher", name: "Relentless Researcher", description: "Curious, thorough, and detail-obsessed. Digs until the answer is solid." },
  { id: "builder", name: "Pragmatic Builder", description: "Hands-on, resourceful, and shipping-focused. Prefers working solutions over theory." },
  { id: "advisor", name: "Diplomatic Advisor", description: "Tactful, thoughtful, and balanced. Frames hard truths with care." },
];

// ── Skills (organized by expertise) ──────────────────────────────────────────

interface SkillCatalogEntry {
  readonly name: string;
  readonly category: string;
  readonly source_url: string;
}

const skillCatalog = catalogData as ReadonlyArray<{ name: string; category: string; source_url: string }>;
const skillByName = new Map<string, SkillCatalogEntry>(
  skillCatalog.map((s) => [s.name, { name: s.name, category: s.category, source_url: s.source_url }]),
);

export interface OnboardingSkill {
  /** Catalog name used to install the skill. */
  readonly name: string;
  /** Friendly display label. */
  readonly label: string;
  /** One-line description shown in the wizard. */
  readonly description: string;
  readonly category: string;
  readonly sourceUrl: string;
}

export interface ExpertiseGroup {
  /**
   * Group id. For every group except `popular` this is a canonical
   * marketplace expertise slug (see `marketplace-expertise.ts`) so the
   * selection can be folded into `agent.expertise`.
   */
  readonly id: string;
  readonly label: string;
  readonly skills: readonly OnboardingSkill[];
}

interface SkillSeed {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

function resolveSkills(seeds: readonly SkillSeed[]): readonly OnboardingSkill[] {
  const resolved: OnboardingSkill[] = [];
  for (const seed of seeds) {
    const entry = skillByName.get(seed.name);
    if (!entry) continue; // skip names not present in the catalog
    resolved.push({
      name: seed.name,
      label: seed.label,
      description: seed.description,
      category: entry.category,
      sourceUrl: entry.source_url,
    });
  }
  return resolved;
}

/** Popular group is rendered first (far left), per spec. */
export const EXPERTISE_SKILL_GROUPS: readonly ExpertiseGroup[] = [
  {
    id: "popular",
    label: "Popular",
    skills: resolveSkills([
      { name: "coding-agent", label: "Coding Agent", description: "Write, edit, and ship code across your repos." },
      { name: "github", label: "GitHub", description: "Manage repos, issues, and pull requests." },
      { name: "slack", label: "Slack", description: "Read and send messages in your workspace." },
      { name: "tavily", label: "Web Research", description: "Search the web and synthesize cited findings." },
      { name: "notion", label: "Notion", description: "Capture notes and update your workspace." },
      { name: "gifgrep", label: "Image Search", description: "Find images and GIFs on demand." },
    ]),
  },
  {
    id: "coding",
    label: "Coding",
    skills: resolveSkills([
      { name: "coding-agent", label: "Coding Agent", description: "Write, edit, and ship code across your repos." },
      { name: "github", label: "GitHub", description: "Manage repos, issues, and pull requests." },
      { name: "gh-issues", label: "GitHub Issues", description: "Triage, file, and update issues quickly." },
      { name: "tmux", label: "Tmux", description: "Drive long-running terminal sessions." },
      { name: "node-connect", label: "Node Connect", description: "Run and inspect Node.js processes." },
    ]),
  },
  {
    id: "research",
    label: "Research",
    skills: resolveSkills([
      { name: "tavily", label: "Web Research", description: "Search the web and synthesize cited findings." },
      { name: "summarize", label: "Summarize", description: "Condense long documents into key points." },
      { name: "oracle", label: "Oracle", description: "Answer deep questions with reasoning." },
      { name: "weather", label: "Weather", description: "Pull current and forecast conditions." },
    ]),
  },
  {
    id: "writing",
    label: "Writing",
    skills: resolveSkills([
      { name: "notion", label: "Notion", description: "Draft and organize docs in Notion." },
      { name: "obsidian", label: "Obsidian", description: "Write and link notes in your vault." },
      { name: "summarize", label: "Summarize", description: "Turn raw material into clean prose." },
      { name: "bear-notes", label: "Bear Notes", description: "Capture and manage Bear notes." },
    ]),
  },
  {
    id: "social-media",
    label: "Social & Comms",
    skills: resolveSkills([
      { name: "slack", label: "Slack", description: "Read and send messages in your workspace." },
      { name: "discord", label: "Discord", description: "Manage channels and post updates." },
      { name: "himalaya", label: "Email", description: "Search, draft, and send email." },
      { name: "wacli", label: "WhatsApp", description: "Send and read WhatsApp messages." },
    ]),
  },
  {
    id: "design",
    label: "Design & Media",
    skills: resolveSkills([
      { name: "gifgrep", label: "Image Search", description: "Find images and GIFs on demand." },
      { name: "canvas", label: "Canvas", description: "Generate and edit visual artifacts." },
      { name: "peekaboo", label: "Screenshots", description: "Capture and inspect what's on screen." },
      { name: "nano-pdf", label: "PDF Tools", description: "Read, split, and edit PDFs." },
    ]),
  },
  {
    id: "productivity",
    label: "Productivity",
    skills: resolveSkills([
      { name: "things-mac", label: "Things", description: "Manage your tasks and projects." },
      { name: "trello", label: "Trello", description: "Move cards across your boards." },
      { name: "apple-reminders", label: "Reminders", description: "Create and complete reminders." },
      { name: "taskflow", label: "TaskFlow", description: "Automate recurring task workflows." },
    ]),
  },
];

const EXPERTISE_GROUP_SLUGS = new Set(
  EXPERTISE_SKILL_GROUPS.map((g) => g.id).filter((id) => id !== "popular" && id !== "productivity"),
);

/**
 * Derive marketplace expertise slugs from the set of selected skills, by
 * collecting the (non-popular) groups those skills belong to. Used at apply
 * time to populate `agent.expertise`.
 */
export function deriveExpertiseFromSkills(selected: readonly string[]): readonly string[] {
  const slugs = new Set<string>();
  for (const group of EXPERTISE_SKILL_GROUPS) {
    if (!EXPERTISE_GROUP_SLUGS.has(group.id)) continue;
    if (group.skills.some((s) => selected.includes(s.name))) slugs.add(group.id);
  }
  return [...slugs];
}

/** Resolve a skill name to its catalog source URL (for install). */
export function skillSourceUrl(name: string): string | undefined {
  return skillByName.get(name)?.source_url;
}

// ── Integrations ─────────────────────────────────────────────────────────────

export type IntegrationTier = "primary" | "standard";

export interface OnboardingIntegration {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly Icon: LucideIcon;
  readonly tier: IntegrationTier;
}

/** Gmail + Calendar are the primary recommendations (both backed by Google). */
export const ONBOARDING_INTEGRATIONS: readonly OnboardingIntegration[] = [
  { id: "gmail", label: "Gmail", description: "Search, draft, and send email.", Icon: Mail, tier: "primary" },
  { id: "google_calendar", label: "Google Calendar", description: "Review and create calendar events.", Icon: CalendarDays, tier: "primary" },
  { id: "github", label: "GitHub", description: "Repos, issues, and pull requests.", Icon: GitBranch, tier: "standard" },
  { id: "slack", label: "Slack", description: "Messages across your workspace.", Icon: MessagesSquare, tier: "standard" },
  { id: "notion", label: "Notion", description: "Docs and knowledge base.", Icon: FileText, tier: "standard" },
  { id: "brave_search", label: "Brave Search", description: "Private web search.", Icon: Search, tier: "standard" },
];

// ── Automations ──────────────────────────────────────────────────────────────

export interface AutomationPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly Icon: LucideIcon;
}

export const AUTOMATION_PRESETS: readonly AutomationPreset[] = [
  { id: "daily_research_report", name: "Daily research report", description: "A morning briefing on the topics you track.", Icon: Newspaper },
  { id: "daily_email_summary", name: "Daily email summary", description: "A digest of overnight inbox activity.", Icon: Inbox },
  { id: "daily_calendar_review", name: "Daily calendar review", description: "Your schedule and prep for the day ahead.", Icon: CalendarCheck },
  { id: "weekly_social_digest", name: "Weekly social digest", description: "Highlights from your channels each week.", Icon: Share2 },
  { id: "morning_briefing", name: "Morning briefing", description: "News, weather, and priorities to start the day.", Icon: Coffee },
];

// ── Messaging providers ──────────────────────────────────────────────────────

export type MessagingStatus = "available" | "coming_soon";

export interface MessagingProvider {
  readonly id: string;
  readonly name: string;
  readonly status: MessagingStatus;
  readonly Icon: LucideIcon;
}

/** Mirrors `apps/agents/.../MessagingTab` — only Telegram is live today. */
export const MESSAGING_PROVIDERS: readonly MessagingProvider[] = [
  { id: "telegram", name: "Telegram", status: "available", Icon: Send },
  { id: "signal", name: "Signal", status: "coming_soon", Icon: MessageCircle },
  { id: "whatsapp", name: "WhatsApp", status: "coming_soon", Icon: MessageSquare },
  { id: "slack", name: "Slack", status: "coming_soon", Icon: MessagesSquare },
  { id: "discord", name: "Discord", status: "coming_soon", Icon: Hash },
];
