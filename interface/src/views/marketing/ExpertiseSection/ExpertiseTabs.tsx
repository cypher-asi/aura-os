import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
    label: "General",
    blurb: "Reason through any task and turn ambiguity into action.",
  },
  {
    label: "Coding",
    blurb: "Ship features from repo context to tested PRs.",
  },
  {
    label: "Design",
    blurb: "Turn rough ideas into polished interfaces.",
  },
  {
    label: "Creative",
    blurb: "Brainstorm sharper campaigns, concepts, and copy.",
  },
  {
    label: "Video",
    blurb: "Plan, edit, and caption clips for every platform.",
  },
  {
    label: "Social",
    blurb: "Draft posts and calendars that stay on voice.",
  },
  {
    label: "Accounting",
    blurb: "Reconcile books and surface the numbers that matter.",
  },
  {
    label: "Legal",
    blurb: "Review contracts and explain obligations clearly.",
  },
  {
    label: "More",
    blurb: "Dozens more expert agents for whatever work demands.",
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
  const rowRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  // Tracks the index the underline was last positioned for. `null`
  // means nothing has been applied yet (initial mount); a stored value
  // equal to the current `activeIndex` means the effect re-ran from a
  // resize / reflow rather than a tab click. Neither should animate.
  const lastAppliedIndexRef = useRef<number | null>(null);

  /*
   * Position the single sliding underline under the active tab and keep
   * it aligned as the row reflows (resize / font load / wrap).
   *
   * The geometry is written imperatively to the indicator node (not via
   * React state): a `setState` round-trip inside a layout effect emits
   * two commits before paint (old rect, then new rect), which Chromium
   * collapses into one style-change cycle so the `transform` delta never
   * triggers the CSS transition and the marker snaps. Writing straight
   * to the DOM keeps a single style write per click and lets the browser
   * see a clean previous -> next transform between paints, which is what
   * fires the slide. (Same fix as `SlidingPills`.)
   */
  useLayoutEffect(() => {
    const apply = (animate: boolean) => {
      const el = tabRefs.current[activeIndex];
      const indicator = indicatorRef.current;
      if (!el || !indicator) return;
      if (!animate) indicator.style.transition = "none";
      indicator.style.transform = `translateX(${el.offsetLeft}px)`;
      indicator.style.top = `${el.offsetTop + el.offsetHeight + 13}px`;
      indicator.style.width = `${el.offsetWidth}px`;
      indicator.style.opacity = "1";
      if (!animate) {
        // Force a style flush so the `transition: none` write commits
        // against the new geometry before the CSS-cascaded transition is
        // restored; otherwise the browser collapses both writes into one
        // change and animates the delta.
        void indicator.offsetWidth;
        indicator.style.transition = "";
      }
    };

    const isUserDriven =
      lastAppliedIndexRef.current !== null &&
      lastAppliedIndexRef.current !== activeIndex;
    apply(isUserDriven);
    lastAppliedIndexRef.current = activeIndex;

    const row = rowRef.current;
    // ResizeObserver fires once immediately on `.observe()`; skip that
    // first callback so it never overwrites an in-progress slide with
    // `transition: none`.
    let firstCallback = true;
    const realign = () => apply(false);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (firstCallback) {
              firstCallback = false;
              return;
            }
            realign();
          })
        : null;
    if (observer && row) observer.observe(row);
    window.addEventListener("resize", realign);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", realign);
    };
  }, [activeIndex]);

  return (
    <div className="expertiseTabs">
      <div
        className="expertiseTabsRow"
        role="tablist"
        aria-label="Expertise"
        ref={rowRef}
      >
        {EXPERTISE_TABS.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${baseId}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${index}`}
              className="expertiseTab"
              data-selected={selected ? "true" : "false"}
              onClick={() => setActiveIndex(index)}
            >
              {/*
               * Bold-weight ghost reserves the selected width on every
               * tab so promoting one to `font-weight: 600` never widens
               * it and reflows the row. The visible label overlaps the
               * ghost in the same grid cell.
               */}
              <span className="expertiseTabGhost" aria-hidden="true">
                {tab.label}
              </span>
              <span className="expertiseTabLabel">{tab.label}</span>
            </button>
          );
        })}
        <span
          ref={indicatorRef}
          className="expertiseTabsIndicator"
          aria-hidden="true"
        />
      </div>
      {/*
       * All blurbs are stacked in one grid cell so the panel always
       * reserves the height of the tallest blurb at the current width.
       * Only the active blurb is visible; inactive ones stay in flow
       * (visibility: hidden) so switching tabs never shifts the bento
       * below.
       */}
      <div className="expertiseTabsPanel">
        {EXPERTISE_TABS.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <p
              key={tab.label}
              id={`${baseId}-panel-${index}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${index}`}
              aria-hidden={selected ? undefined : "true"}
              className="expertiseTabsPanelItem"
              data-active={selected ? "true" : "false"}
            >
              {tab.blurb}
            </p>
          );
        })}
      </div>
    </div>
  );
}
