import { type ReactNode } from "react";
import { Section } from "../Section";
import "./ExpertiseSection.css";

const HEADLINE_ID = "expertiseSectionHeadline";

/**
 * Marketing section that sits directly below the `/agents` hero
 * (`MarketingFirstScreen`) and above the "An agent designed for you."
 * bento (`PersonalAgentSection`). A simple centered headline + subhead
 * built on the shared `<Section />` shell so its outer rhythm
 * (background tint, padding, viewport-height reservation, column cap)
 * matches every other themed marketing section.
 */
export function ExpertiseSection(): ReactNode {
  return (
    <Section ariaLabelledBy={HEADLINE_ID}>
      <div className="expertiseInner">
        <h2 id={HEADLINE_ID} className="expertiseHeadline">
          Expertise without ego.
        </h2>
        <p className="expertiseSubhead">
          AURA agents are experts in every discipline&mdash;from coding to
          science to creativity.
        </p>
      </div>
    </Section>
  );
}
