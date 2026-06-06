import { type ReactNode } from "react";
import { Section } from "../Section";
import "./ExpertiseSection.css";

const HEADLINE_ID = "expertiseSectionHeadline";

/**
 * Marketing section that sits directly below the `/agents` hero
 * (`MarketingFirstScreen`) and above the "An agent designed for you."
 * bento (`PersonalAgentSection`). A simple centered headline + subhead
 * built on the shared `<Section />` shell. It opts OUT of the shell's
 * full-viewport reservation (`fullHeight={false}`) because its content
 * is just a headline + subhead; instead the inner band is sized to the
 * SAME height as the hero text band (`MarketingFirstScreen.heroBand`,
 * `clamp(280px, 50vh, 560px)`) so this intro reads as a peer of the top
 * hero text area rather than floating in a full empty screen.
 */
export function ExpertiseSection(): ReactNode {
  return (
    <Section ariaLabelledBy={HEADLINE_ID} fullHeight={false}>
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
