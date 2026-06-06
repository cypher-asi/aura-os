import { type ReactNode } from "react";
import { Section } from "../Section";
import "./SpecQuadrantSection.css";

/**
 * Marketing bento that sits after `ExpertiseSection` on the `/agents`
 * page. Mirrors the product-spec reference layout: two cells on the top
 * row and one wide cell spanning the bottom row, each a diagonal-gradient
 * panel separated by hairline seams and clipped into one rounded band.
 *
 * Reuses the cell gradient / seam / rounded-band treatment from
 * `PersonalAgentSection` (the bento directly below). Each cell carries a
 * bottom-left corner label + title; the media wells are intentionally
 * empty placeholders for now (copy is placeholder too, to be filled in).
 *
 * Opts out of the shell's full-viewport reservation (`fullHeight={false}`)
 * so the bento sits directly beneath the compact `ExpertiseSection` intro
 * instead of floating centered in its own empty screen.
 */
export function SpecQuadrantSection(): ReactNode {
  return (
    <Section
      ariaLabel="Feature highlights"
      fullHeight={false}
      className="specQuadrantSection"
    >
      <div className="specQuadrantGrid">
        <article className="specQuadrantCell specQuadrantCellA">
          <div className="specQuadrantMedia" aria-hidden="true" />
          <div className="specQuadrantCopy">
            <span className="specQuadrantLabel">Feature one&mdash;</span>
            <span className="specQuadrantTitle">Short headline here</span>
          </div>
        </article>

        <article className="specQuadrantCell specQuadrantCellB">
          <div className="specQuadrantMedia" aria-hidden="true" />
          <div className="specQuadrantCopy">
            <span className="specQuadrantLabel">Feature two&mdash;</span>
            <span className="specQuadrantTitle">Short headline here</span>
          </div>
        </article>

        <article className="specQuadrantCell specQuadrantCellWide">
          <div className="specQuadrantMedia" aria-hidden="true" />
          <div className="specQuadrantCopy">
            <span className="specQuadrantLabel">Feature three&mdash;</span>
            <span className="specQuadrantTitle">Short headline here</span>
          </div>
        </article>
      </div>
    </Section>
  );
}
