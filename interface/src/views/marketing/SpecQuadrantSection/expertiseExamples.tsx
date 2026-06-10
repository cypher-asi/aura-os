import { type ReactNode } from "react";

/**
 * Per-discipline data + right-flank example mockups for the
 * `NoiseReductionCard` screen. `General` is the default and keeps the bespoke
 * looping code (left) + paint (right) flanks rendered by the card itself.
 * Every other discipline drives a typewriter capability list on the LEFT flank
 * (see `CapabilityList` in `expertiseContent.tsx`) and one of the small
 * CSS/SVG example mockups here on the RIGHT flank, both flanking the always-on
 * centered brain. This module intentionally exports only data/constants (no
 * top-level React component) so it isn't a fast-refresh boundary.
 */
export const EXPERTISES = [
  "General",
  "Research",
  "Writing",
  "Creative",
  "Social",
  "Sales",
  "Marketing",
  "Design",
  "Coding",
  "Analytics",
  "Finance",
  "Legal",
] as const;

export type Expertise = (typeof EXPERTISES)[number];

/**
 * 8-12 short capability phrases per discipline, typed out as a bullet list on
 * the screen's left flank. `General` is intentionally empty (the card renders
 * its own code/paint flanks for it).
 */
export const EXPERTISE_CAPABILITIES: Record<Expertise, readonly string[]> = {
  General: [],
  Research: [
    "Synthesize hundreds of sources",
    "Cite every claim",
    "Literature reviews",
    "Data extraction & tables",
    "Statistical analysis",
    "Hypothesis testing",
    "PDF reports & whitepapers",
    "Fact-checking",
    "Competitive landscapes",
    "Peer-review critique",
  ],
  Writing: [
    "Long-form articles",
    "Match your voice & tone",
    "Edit & proofread",
    "Outlines to drafts",
    "Technical documentation",
    "SEO-aware copy",
    "Rewrite & condense",
    "Multilingual translation",
    "Citations & references",
    "Headlines & hooks",
  ],
  Creative: [
    "Story & script writing",
    "Brainstorm at scale",
    "Character & world building",
    "Poetry & lyrics",
    "Concept ideation",
    "Naming & taglines",
    "Mood & tone shifts",
    "Plot structure",
    "Dialogue polishing",
    "Pitch decks",
  ],
  Social: [
    "Schedule & auto-post",
    "Multi-platform workflows",
    "Reply & engage",
    "Trend monitoring",
    "Content calendars",
    "Hashtag strategy",
    "Caption generation",
    "Analytics & insights",
    "Influencer outreach",
    "Community management",
  ],
  Sales: [
    "Lead qualification",
    "Pipeline management",
    "Personalized outreach",
    "Follow-up sequences",
    "CRM updates",
    "Call summaries & notes",
    "Proposal drafting",
    "Objection handling",
    "Revenue forecasting",
    "Deal scoring",
  ],
  Marketing: [
    "Campaign planning",
    "Email & ad copy",
    "A/B testing",
    "Audience segmentation",
    "SEO & keyword research",
    "Landing pages",
    "Brand messaging",
    "Performance analytics",
    "Funnel optimization",
    "Content distribution",
  ],
  Design: [
    "UI & UX mockups",
    "Design systems",
    "Logos & branding",
    "Color & typography",
    "Wireframes to prototypes",
    "Image generation & edits",
    "Iconography",
    "Layout & composition",
    "Accessibility checks",
    "Export-ready assets",
  ],
  Coding: [
    "Full-stack development",
    "Refactor & optimize",
    "Debug & fix",
    "Write & run tests",
    "Code review",
    "API integration",
    "Documentation",
    "Migrations & upgrades",
    "CI/CD pipelines",
    "Architecture design",
  ],
  Analytics: [
    "Dashboards & reports",
    "SQL & queries",
    "Data cleaning",
    "Trend detection",
    "Forecasting models",
    "Cohort analysis",
    "KPI tracking",
    "Anomaly detection",
    "Visualizations",
    "Data storytelling",
  ],
  Finance: [
    "Financial modeling",
    "Budgets & forecasts",
    "Expense tracking",
    "Scenario analysis",
    "Invoicing & reconciliation",
    "Valuation & DCF",
    "Cash-flow projections",
    "Investment research",
    "Risk assessment",
    "Reporting & compliance",
  ],
  Legal: [
    "Contract drafting",
    "Clause review & redlines",
    "Risk flagging",
    "Compliance checks",
    "Legal research",
    "Case-law summaries",
    "NDA & agreement templates",
    "Due diligence",
    "Policy drafting",
    "Plain-language explainers",
  ],
};

/** Render N stacked text-line bars at the given width percentages. */
function lineRows(widths: readonly number[]): ReactNode {
  return widths.map((w, i) => (
    <span className="nrExLine" style={{ width: `${w}%` }} key={i} />
  ));
}

/** Render N chart bars at the given height percentages. */
function bars(heights: readonly number[]): ReactNode {
  return heights.map((h, i) => (
    <span className="nrExBar" style={{ height: `${h}%` }} key={i} />
  ));
}

/** The inner per-discipline right-flank mockup (sans float/scale wrappers). */
function renderExample(expertise: Expertise): ReactNode {
  switch (expertise) {
    case "Research":
      return (
        <div className="nrExPaper nrExResearch">
          <span className="nrExPaperBadge">PDF</span>
          <span className="nrExHeading" style={{ width: "72%" }} />
          <span className="nrExSub" style={{ width: "46%" }} />
          <div className="nrExFig">{bars([40, 66, 52, 80, 58, 72])}</div>
          <div className="nrExTwoCol">
            <div className="nrExCol">{lineRows([100, 90, 96, 82, 88])}</div>
            <div className="nrExCol">{lineRows([100, 86, 92, 78, 90])}</div>
          </div>
        </div>
      );
    case "Writing":
      return (
        <div className="nrExPaper nrExWriting">
          <span className="nrExHeading" style={{ width: "62%" }} />
          <div className="nrExPara">{lineRows([100, 96, 92, 98, 88])}</div>
          <div className="nrExPara">{lineRows([100, 90, 70])}</div>
        </div>
      );
    case "Creative":
      return (
        <div className="nrExMood">
          <span className="nrExTile nrExTile1" />
          <span className="nrExTile nrExTile2" />
          <span className="nrExTile nrExTile3" />
          <span className="nrExTile nrExTile4" />
          <span className="nrExTile nrExTile5" />
          <span className="nrExTile nrExTile6" />
        </div>
      );
    case "Social":
      return (
        <div className="nrExSocial">
          <div className="nrExFlow">
            <span className="nrExNode">@</span>
            <span className="nrExWire" />
            <span className="nrExNode">AI</span>
            <span className="nrExWire" />
            <span className="nrExNode">{"\u2197"}</span>
          </div>
          <div className="nrExCard">
            <div className="nrExPostHead">
              <span className="nrExAvatar" />
              <span className="nrExLine" style={{ width: "52%" }} />
            </div>
            {lineRows([100, 78])}
            <div className="nrExPostFoot">
              <span className="nrExChip">{"\u2665"} 2.4k</span>
              <span className="nrExChip">{"\u21bb"} 318</span>
              <span className="nrExChip">{"\u2197"} Post</span>
            </div>
          </div>
        </div>
      );
    case "Sales":
      return (
        <div className="nrExPanel nrExSales">
          <div className="nrExPanelHead">
            <span className="nrExLine" style={{ width: "42%" }} />
            <span className="nrExMetric">$1.2M</span>
          </div>
          <div className="nrExKanban">
            <div className="nrExKanCol">
              <span className="nrExKanColHead" />
              <span className="nrExDeal" />
              <span className="nrExDeal" />
            </div>
            <div className="nrExKanCol">
              <span className="nrExKanColHead" />
              <span className="nrExDeal" />
            </div>
            <div className="nrExKanCol">
              <span className="nrExKanColHead" />
              <span className="nrExDeal" />
              <span className="nrExDeal" />
            </div>
          </div>
        </div>
      );
    case "Marketing":
      return (
        <div className="nrExPanel nrExMarketing">
          <div className="nrExChips">
            <span className="nrExChip">Email</span>
            <span className="nrExChip">Ads</span>
            <span className="nrExChip">SEO</span>
          </div>
          <div className="nrExFunnel">
            <span className="nrExFunStep" style={{ width: "100%" }} />
            <span className="nrExFunStep" style={{ width: "78%" }} />
            <span className="nrExFunStep" style={{ width: "54%" }} />
            <span className="nrExFunStep" style={{ width: "32%" }} />
          </div>
          <div className="nrExStat">
            <span className="nrExMetric">4.8% CTR</span>
            <span className="nrExLine" style={{ width: "38%" }} />
          </div>
        </div>
      );
    case "Design":
      return (
        <div className="nrExWin nrExDesign">
          <div className="nrExWinBar">
            <span />
            <span />
            <span />
          </div>
          <div className="nrExWinBody">
            <div className="nrExHero" />
            <div className="nrExRow">
              <span className="nrExBtn" />
              <span className="nrExSwatch nrExSw1" />
              <span className="nrExSwatch nrExSw2" />
              <span className="nrExSwatch nrExSw3" />
            </div>
            <div className="nrExGrid3">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      );
    case "Coding":
      return (
        <div className="nrExWin nrExCoding">
          <div className="nrExWinBar">
            <span />
            <span />
            <span />
          </div>
          <div className="nrExCode">
            <span className="nrExCodeLine">
              <span className="tkKw">const</span>{" "}
              <span className="tkVar">agent</span> ={" "}
              <span className="tkFn">create</span>(
              <span className="tkStr">"aura"</span>)
            </span>
            <span className="nrExCodeLine">
              <span className="tkKw">await</span>{" "}
              <span className="tkVar">agent</span>.
              <span className="tkFn">run</span>()
            </span>
            <span className="nrExCodeLine">
              <span className="tkKw">return</span>{" "}
              <span className="tkNum">200</span>
            </span>
          </div>
          <div className="nrExTerm">
            <span className="nrExTermPrompt">$</span> npm run deploy {"\u2714"}
          </div>
        </div>
      );
    case "Analytics":
      return (
        <div className="nrExPanel nrExAnalytics">
          <div className="nrExKpis">
            <span className="nrExKpi">
              <b>92%</b>
              <i />
            </span>
            <span className="nrExKpi">
              <b>1.4k</b>
              <i />
            </span>
            <span className="nrExKpi">
              <b>+18%</b>
              <i />
            </span>
          </div>
          <svg className="nrExSvg" viewBox="0 0 100 36" preserveAspectRatio="none">
            <polyline
              className="nrExPoly"
              points="0,28 16,22 32,26 48,14 64,18 80,8 100,12"
            />
          </svg>
          <div className="nrExFig">{bars([45, 70, 55, 82, 62])}</div>
        </div>
      );
    case "Finance":
      return (
        <div className="nrExPanel nrExFinance">
          <div className="nrExPanelHead">
            <span className="nrExLine" style={{ width: "34%" }} />
            <span className="nrExMetric nrExUp">+$48.2k</span>
          </div>
          <svg className="nrExSvg" viewBox="0 0 100 30" preserveAspectRatio="none">
            <polyline
              className="nrExPoly nrExPolyUp"
              points="0,26 20,22 40,18 60,20 80,10 100,4"
            />
          </svg>
          <div className="nrExSheet">
            <div className="nrExSheetRow">
              <span className="nrExCell" />
              <span className="nrExCell is-num" />
              <span className="nrExCell is-num" />
              <span className="nrExCell" />
            </div>
            <div className="nrExSheetRow">
              <span className="nrExCell" />
              <span className="nrExCell is-num" />
              <span className="nrExCell" />
              <span className="nrExCell is-num" />
            </div>
            <div className="nrExSheetRow">
              <span className="nrExCell" />
              <span className="nrExCell" />
              <span className="nrExCell is-num" />
              <span className="nrExCell is-num" />
            </div>
          </div>
        </div>
      );
    case "Legal":
      return (
        <div className="nrExPaper nrExLegal">
          <span className="nrExHeading" style={{ width: "56%" }} />
          <div className="nrExClause">
            <span className="nrExNum">1.</span>
            <span className="nrExLine" style={{ width: "82%" }} />
          </div>
          <div className="nrExClause">
            <span className="nrExNum">2.</span>
            <span className="nrExLine" style={{ width: "74%" }} />
          </div>
          <div className="nrExClause">
            <span className="nrExNum">3.</span>
            <span className="nrExLine" style={{ width: "88%" }} />
          </div>
          <div className="nrExSign">
            <svg className="nrExSignMark" viewBox="0 0 60 20">
              <path d="M2 14 C 8 2, 14 18, 20 10 S 32 2, 40 12 S 54 4, 58 7" />
            </svg>
            <span className="nrExSeal" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

/**
 * Build the right-flank example component for one discipline: the inner mockup
 * wrapped in fade-in (`.nrExample`), responsive scale (`.nrExScale`), and a
 * gentle float (`.nrExFloat`). The card renders these via `EXAMPLE_COMPONENTS`.
 */
function makeExampleComponent(expertise: Expertise): () => ReactNode {
  return function ExpertiseExample(): ReactNode {
    return (
      <div className="nrExample">
        <div className="nrExScale">
          <div className="nrExFloat">{renderExample(expertise)}</div>
        </div>
      </div>
    );
  };
}

/**
 * Right-flank example mockup per discipline. `General` maps to a no-op since
 * the card renders its own paint flank for it; the card only looks up
 * non-General disciplines here.
 */
export const EXAMPLE_COMPONENTS: Record<Expertise, () => ReactNode> = {
  General: () => null,
  Research: makeExampleComponent("Research"),
  Writing: makeExampleComponent("Writing"),
  Creative: makeExampleComponent("Creative"),
  Social: makeExampleComponent("Social"),
  Sales: makeExampleComponent("Sales"),
  Marketing: makeExampleComponent("Marketing"),
  Design: makeExampleComponent("Design"),
  Coding: makeExampleComponent("Coding"),
  Analytics: makeExampleComponent("Analytics"),
  Finance: makeExampleComponent("Finance"),
  Legal: makeExampleComponent("Legal"),
};
