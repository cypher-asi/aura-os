/**
 * Shared data for the Expertise dropdown (in `PublicTopNav`) and the
 * `/expertise/:slug` detail pages (`ExpertiseDetailView`).
 *
 * Two groups drive the dropdown's two columns:
 *   - `CAPABILITIES` mirror the discipline tabs on the `/agents` page
 *     (`ExpertiseTabs`): what an AURA agent can do.
 *   - `INDUSTRIES` are the verticals those capabilities serve.
 *
 * Each entry resolves to a detail page composed from the shared
 * marketing section components, so adding a section is just adding an
 * object here. `slug` must be unique across BOTH groups since they
 * share the `/expertise/:slug` route (e.g. the Legal capability is
 * `legal` while the Legal industry is `legal-services`).
 */

export type ExpertiseKind = "capability" | "industry";

export interface ExpertiseUseCase {
  readonly title: string;
  readonly description: string;
}

export interface ExpertiseEntry {
  readonly slug: string;
  readonly kind: ExpertiseKind;
  /** Short label shown in the nav dropdown. */
  readonly label: string;
  /** Large hero headline on the detail page. */
  readonly headline: string;
  /** One-to-two line hero subhead. */
  readonly heroBlurb: string;
  /** Overview paragraph(s) under the hero. */
  readonly overview: string;
  /** Bento cards rendered in the "Use cases" section. */
  readonly useCases: readonly ExpertiseUseCase[];
}

export const CAPABILITIES: readonly ExpertiseEntry[] = [
  {
    slug: "research",
    kind: "capability",
    label: "Research",
    headline: "Research that synthesizes, not just searches.",
    heroBlurb:
      "Agents that dig through sources and surface what actually matters.",
    overview:
      "AURA research agents read across documents, the web, and your own knowledge base, then synthesize findings into clear, citable answers. They keep working in the background so a deep review that used to take days lands while you focus on the decision.",
    useCases: [
      {
        title: "Literature reviews",
        description: "Survey a field and summarize the state of the art with sources.",
      },
      {
        title: "Competitive analysis",
        description: "Track competitors and distill moves into a running brief.",
      },
      {
        title: "Due diligence",
        description: "Pull signals from filings, news, and data rooms into one view.",
      },
    ],
  },
  {
    slug: "writing",
    kind: "capability",
    label: "Writing",
    headline: "Writing in your voice, at your pace.",
    heroBlurb: "Draft, edit, and polish prose that sounds like you.",
    overview:
      "AURA writing agents learn your tone and constraints, then draft and revise long-form content end to end. From first outline to final edit, they keep the voice consistent and the facts grounded in your sources.",
    useCases: [
      {
        title: "Long-form drafts",
        description: "Turn an outline and notes into a finished piece.",
      },
      {
        title: "Editing passes",
        description: "Tighten structure, grammar, and tone without losing intent.",
      },
      {
        title: "Repurposing",
        description: "Reshape one source into posts, emails, and summaries.",
      },
    ],
  },
  {
    slug: "creative",
    kind: "capability",
    label: "Creative",
    headline: "Sharper concepts, faster.",
    heroBlurb: "Brainstorm campaigns, concepts, and copy that land.",
    overview:
      "AURA creative agents generate and pressure-test ideas, then build out the ones worth keeping. They move from blank page to a slate of directions you can react to in minutes.",
    useCases: [
      {
        title: "Campaign concepts",
        description: "Generate distinct directions with rationale for each.",
      },
      {
        title: "Naming & taglines",
        description: "Explore options against your brief and constraints.",
      },
      {
        title: "Moodboards",
        description: "Assemble references and copy into a shareable concept.",
      },
    ],
  },
  {
    slug: "social",
    kind: "capability",
    label: "Social",
    headline: "On-voice social, on schedule.",
    heroBlurb: "Draft posts and calendars that stay on brand.",
    overview:
      "AURA social agents plan calendars, draft posts per channel, and adapt to each platform's format while holding your voice. They keep a steady cadence so your channels never go quiet.",
    useCases: [
      {
        title: "Content calendars",
        description: "Plan weeks of posts around themes and launches.",
      },
      {
        title: "Per-channel drafts",
        description: "Adapt one idea to each platform's format and tone.",
      },
      {
        title: "Community replies",
        description: "Draft on-voice responses for review before they ship.",
      },
    ],
  },
  {
    slug: "design",
    kind: "capability",
    label: "Design",
    headline: "From rough idea to polished interface.",
    heroBlurb: "Turn sketches and prompts into usable designs.",
    overview:
      "AURA design agents translate intent into structured, consistent interfaces, respecting your system and constraints. They iterate on layouts and components so you start from something real instead of a blank canvas.",
    useCases: [
      {
        title: "UI exploration",
        description: "Generate layout options against a brief and design system.",
      },
      {
        title: "Component variants",
        description: "Produce consistent states and variations at speed.",
      },
      {
        title: "Design review",
        description: "Flag accessibility and consistency issues early.",
      },
    ],
  },
  {
    slug: "coding",
    kind: "capability",
    label: "Coding",
    headline: "Ship features while you sleep.",
    heroBlurb: "From repo context to tested, reviewable PRs.",
    overview:
      "AURA coding agents work from your repository's real context to implement features, fix bugs, and open tested pull requests. They run autonomously and hand back work that is ready to review.",
    useCases: [
      {
        title: "Feature work",
        description: "Implement scoped features end to end with tests.",
      },
      {
        title: "Bug fixes",
        description: "Reproduce, fix, and verify with a clear PR.",
      },
      {
        title: "Refactors",
        description: "Apply consistent changes across the codebase safely.",
      },
    ],
  },
  {
    slug: "analytics",
    kind: "capability",
    label: "Analytics",
    headline: "Raw data into decision-ready insight.",
    heroBlurb: "Turn numbers into clear answers you can act on.",
    overview:
      "AURA analytics agents query, clean, and interpret data, then explain what it means in plain language. They surface the trend, the cause, and the recommended next step.",
    useCases: [
      {
        title: "Ad-hoc analysis",
        description: "Answer a business question directly from the data.",
      },
      {
        title: "Reporting",
        description: "Generate recurring reports with narrative context.",
      },
      {
        title: "Anomaly detection",
        description: "Flag unexpected shifts and explain likely drivers.",
      },
    ],
  },
  {
    slug: "finance",
    kind: "capability",
    label: "Finance",
    headline: "Model the numbers that matter.",
    heroBlurb: "Build budgets and forecasts, and surface the signal.",
    overview:
      "AURA finance agents build and maintain models, reconcile data, and explain the drivers behind every figure. They keep forecasts current so planning is grounded in the latest reality.",
    useCases: [
      {
        title: "Forecasting",
        description: "Build and update driver-based models on demand.",
      },
      {
        title: "Budget tracking",
        description: "Reconcile actuals against plan and explain variance.",
      },
      {
        title: "Scenario planning",
        description: "Compare outcomes across assumptions in minutes.",
      },
    ],
  },
  {
    slug: "legal",
    kind: "capability",
    label: "Legal",
    headline: "Contracts, reviewed and explained.",
    heroBlurb: "Review documents and explain obligations clearly.",
    overview:
      "AURA legal agents read contracts and policies, flag risk, and explain obligations in plain language. They accelerate review while keeping a human in the loop on every decision.",
    useCases: [
      {
        title: "Contract review",
        description: "Flag risky clauses and deviations from your standards.",
      },
      {
        title: "Obligation tracking",
        description: "Extract dates, duties, and renewals into a clear list.",
      },
      {
        title: "Policy Q&A",
        description: "Answer questions grounded in your own documents.",
      },
    ],
  },
];

export const INDUSTRIES: readonly ExpertiseEntry[] = [
  {
    slug: "finance-banking",
    kind: "industry",
    label: "Finance & Banking",
    headline: "Private Intelligence for Finance",
    heroBlurb:
      "Private AI that risk teams trust, regulators accept, and clients rely on. No compromises on data \u2014 ever.",
    overview:
      "Finance runs on trust, and trust runs on control of data. AURA brings autonomous agents to banks, funds, and fintechs without sending sensitive information to third-party models \u2014 anything that leaves your perimeter stays unidentifiable, and the harness is auditable end to end. Analysts, advisors, and operations teams delegate the slow work and keep the judgment, with every action verifiable and on the record.",
    useCases: [
      {
        title: "Research & due diligence",
        description:
          "Synthesize filings, market data, and news into decision-ready briefs with citations.",
      },
      {
        title: "Risk & compliance",
        description:
          "Screen transactions and documents against policy, flagging exceptions for review.",
      },
      {
        title: "Financial modeling",
        description:
          "Build and maintain forecasts and scenarios that update as the numbers move.",
      },
      {
        title: "Client reporting",
        description:
          "Generate portfolio and performance summaries in your voice, on schedule.",
      },
      {
        title: "Operations",
        description:
          "Reconcile data and automate back-office workflows with a full audit trail.",
      },
      {
        title: "Advisory support",
        description:
          "Draft on-brand client communications grounded in your own data.",
      },
    ],
  },
  {
    slug: "healthcare",
    kind: "industry",
    label: "Healthcare",
    headline: "Private Intelligence for Healthcare",
    heroBlurb:
      "Private AI that clinicians trust, regulators accept, and patients deserve. No compromises on data \u2014 ever.",
    overview:
      "Healthcare demands privacy by default. AURA agents support clinical and operational teams while keeping protected data inside your perimeter, with a verifiable, auditable harness throughout.",
    useCases: [
      {
        title: "Clinical research",
        description: "Synthesize literature and trial data into citable summaries.",
      },
      {
        title: "Documentation",
        description: "Draft and structure notes and reports for human review.",
      },
      {
        title: "Operations",
        description: "Automate scheduling and back-office workflows with an audit trail.",
      },
    ],
  },
  {
    slug: "legal-services",
    kind: "industry",
    label: "Legal",
    headline: "Private Intelligence for Legal",
    heroBlurb:
      "Private AI that firms trust and clients rely on. No compromises on confidentiality \u2014 ever.",
    overview:
      "Legal work runs on confidentiality and precision. AURA agents accelerate review, research, and drafting while keeping privileged material inside your perimeter and a human in the loop.",
    useCases: [
      {
        title: "Contract review",
        description: "Flag risk and deviations from your standards at speed.",
      },
      {
        title: "Legal research",
        description: "Pull and synthesize relevant authority with citations.",
      },
      {
        title: "Drafting",
        description: "Produce first drafts grounded in your templates and matter files.",
      },
    ],
  },
  {
    slug: "marketing-media",
    kind: "industry",
    label: "Marketing & Media",
    headline: "Private Intelligence for Marketing",
    heroBlurb:
      "Private AI that keeps your brand on voice and your data your own.",
    overview:
      "Marketing teams move fast across many channels. AURA agents plan, draft, and adapt content on brand while keeping your audience and performance data under your control.",
    useCases: [
      {
        title: "Campaign concepts",
        description: "Generate and pressure-test directions against your brief.",
      },
      {
        title: "Content production",
        description: "Draft and repurpose across channels in your voice.",
      },
      {
        title: "Performance analysis",
        description: "Turn campaign data into clear, actionable insight.",
      },
    ],
  },
  {
    slug: "ecommerce-retail",
    kind: "industry",
    label: "E-commerce & Retail",
    headline: "Private Intelligence for Retail",
    heroBlurb:
      "Private AI that scales your storefront without giving up your data.",
    overview:
      "Retail runs on catalog, content, and customer data. AURA agents automate merchandising, support, and analysis while keeping customer information inside your perimeter.",
    useCases: [
      {
        title: "Catalog & content",
        description: "Generate and maintain product copy at scale.",
      },
      {
        title: "Customer support",
        description: "Draft on-brand responses grounded in your policies.",
      },
      {
        title: "Demand analysis",
        description: "Surface trends and anomalies across sales data.",
      },
    ],
  },
  {
    slug: "education",
    kind: "industry",
    label: "Education",
    headline: "Private Intelligence for Education",
    heroBlurb:
      "Private AI that supports educators and protects student data.",
    overview:
      "Education depends on trust around student data. AURA agents support teaching, research, and administration while keeping records inside your perimeter and a human in the loop.",
    useCases: [
      {
        title: "Course materials",
        description: "Draft and adapt lessons and assessments to your curriculum.",
      },
      {
        title: "Research support",
        description: "Synthesize sources into citable summaries.",
      },
      {
        title: "Administration",
        description: "Automate routine workflows with an audit trail.",
      },
    ],
  },
  {
    slug: "real-estate",
    kind: "industry",
    label: "Real Estate",
    headline: "Private Intelligence for Real Estate",
    heroBlurb:
      "Private AI that moves deals forward and keeps your data your own.",
    overview:
      "Real estate runs on documents, listings, and market data. AURA agents accelerate diligence, drafting, and analysis while keeping client and deal information under your control.",
    useCases: [
      {
        title: "Listing content",
        description: "Generate and maintain listings and marketing copy.",
      },
      {
        title: "Deal diligence",
        description: "Pull signals from documents and market data into one view.",
      },
      {
        title: "Document drafting",
        description: "Produce first drafts grounded in your templates.",
      },
    ],
  },
  {
    slug: "technology-saas",
    kind: "industry",
    label: "Technology / SaaS",
    headline: "Private Intelligence for Technology",
    heroBlurb:
      "Private AI that ships product and keeps your codebase your own.",
    overview:
      "Technology teams build fast and guard their IP. AURA agents accelerate engineering, support, and analysis while keeping your code and customer data inside your perimeter.",
    useCases: [
      {
        title: "Engineering",
        description: "Implement features and fixes from real repo context.",
      },
      {
        title: "Customer support",
        description: "Draft accurate responses grounded in your docs.",
      },
      {
        title: "Product analytics",
        description: "Turn usage data into decision-ready insight.",
      },
    ],
  },
];

const ENTRIES_BY_SLUG: ReadonlyMap<string, ExpertiseEntry> = new Map(
  [...CAPABILITIES, ...INDUSTRIES].map((entry) => [entry.slug, entry]),
);

/** Look up an expertise entry by its route slug, or `undefined`. */
export function getExpertiseEntry(slug: string): ExpertiseEntry | undefined {
  return ENTRIES_BY_SLUG.get(slug);
}
