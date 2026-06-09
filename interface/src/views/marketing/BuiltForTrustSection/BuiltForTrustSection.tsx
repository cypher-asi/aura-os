import { type ReactNode } from "react";
import { Section } from "../Section";
import { CardSection, MetalCard } from "../CardSection";
import { TextCard } from "../TextCard";
import { IsolatedDevice } from "../IsolatedDevice/IsolatedDevice";
import { ServiceButtonRail } from "./ServiceButtonRail";
import "./BuiltForTrustSection.css";

const HEADLINE_ID = "builtForTrustHeadline";

/**
 * Marketing section that tells the security/trust story: a compact H2
 * `<TextCard />` intro, then one connected three-column `<CardSection />`
 * bento — a full-width media card showing the isolated device on top, and
 * three equal copy cards beneath it. Built on the shared `<Section />` /
 * `<CardSection />` / `<MetalCard />` shells so its rhythm matches every
 * other themed marketing section.
 *
 * The three copy cards carry only a title + description (no media well
 * content); `MetalCard`'s media well flex-grows to push the copy to the
 * cell floor, keeping titles bottom-aligned across the row.
 */
export function BuiltForTrustSection(): ReactNode {
  return (
    <>
      <Section
        ariaLabelledBy={HEADLINE_ID}
        fullHeight={false}
        className="builtForTrustIntro"
      >
        <TextCard
          level="h2"
          id={HEADLINE_ID}
          headline="Built for trust."
          subhead="AURA agents run in isolated virtual machines within trusted execution environments."
        />
      </Section>

      <CardSection ariaLabel="How AURA earns your trust" columns={3}>
        <MetalCard
          wide
          short
          gradient={135}
          className="builtForTrustDevice"
          media={
            <div className="builtForTrustStage">
              <ServiceButtonRail />
              <IsolatedDevice />
            </div>
          }
        />
        <MetalCard
          gradient={135}
          align="center"
          className="builtForTrustCopy"
          title="Isolated by default."
          description="Each AURA agent runs in its own sandboxed VM, isolated from your system and other agents."
        />
        <MetalCard
          gradient={225}
          align="center"
          className="builtForTrustCopy"
          title="Trusted execution."
          description="Hardware-backed enclaves keep each agent's memory and compute sealed end to end."
        />
        <MetalCard
          gradient={135}
          align="center"
          className="builtForTrustCopy"
          title="Verifiable end to end."
          description="Every environment is attested before it runs, so you can verify what you're trusting."
        />
      </CardSection>
    </>
  );
}
