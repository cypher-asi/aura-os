import { type ReactNode, useId, useState } from "react";
import "./ExpertiseTabs.css";

/**
 * One expertise category shown in the tab slider. `blurb` is mock
 * placeholder copy for now — swap in real per-discipline messaging
 * later without touching the layout.
 */
interface ExpertiseTab {
  readonly label: string;
  readonly blurb: ReactNode;
}

const EXPERTISE_TABS: readonly ExpertiseTab[] = [
  {
    label: "General Intelligence",
    blurb:
      "Reason across any domain, break ambiguous goals into steps, and adapt to whatever you throw at it.",
  },
  {
    label: "Coding",
    blurb:
      "Ship production features end to end — read the repo, write the code, run the tests, open the PR.",
  },
  {
    label: "Design",
    blurb:
      "Move from rough idea to polished interface with a sharp eye for layout, type, and hierarchy.",
  },
  {
    label: "Creative",
    blurb:
      "Brainstorm campaigns, draft copy, and explore concepts that actually sound like you.",
  },
  {
    label: "Video",
    blurb:
      "Plan, cut, and caption footage into finished clips ready for any platform.",
  },
  {
    label: "Social",
    blurb:
      "Plan calendars, draft posts, and keep every channel on-voice and on-schedule.",
  },
  {
    label: "Accounting",
    blurb:
      "Reconcile the books, categorize transactions, and surface the numbers that matter.",
  },
  {
    label: "Legal",
    blurb:
      "Review contracts, flag risky clauses, and summarize obligations in plain language.",
  },
  {
    label: "Trading",
    blurb:
      "Track markets, model scenarios, and turn signals into clear, defensible theses.",
  },
];

/**
 * Apple-style tab "slider" rendered below the "Expertise without ego."
 * headline. A horizontal row of discipline labels acts as a tablist;
 * the active label is highlighted with an underline and its blurb shows
 * in the panel below. Mock only — clicking a tab swaps the placeholder
 * copy, no data fetching or routing.
 */
export function ExpertiseTabs(): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const activeTab = EXPERTISE_TABS[activeIndex];

  return (
    <div className="expertiseTabs">
      <div className="expertiseTabsRow" role="tablist" aria-label="Expertise">
        {EXPERTISE_TABS.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              className="expertiseTab"
              data-selected={selected ? "true" : "false"}
              onClick={() => setActiveIndex(index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <p
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeIndex}`}
        className="expertiseTabsPanel"
      >
        {activeTab.blurb}
      </p>
    </div>
  );
}
