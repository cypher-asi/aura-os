import { type ReactNode } from "react";
import { Section } from "../Section";
import { CardSection, MetalCard } from "../CardSection";
import { TextCard } from "../TextCard";
import "./BuiltForTrustSection.css";

const HEADLINE_ID = "builtForTrustHeadline";

/**
 * Marketing section that mirrors `PersonalAgentSection`'s shape — a compact
 * H2 `<TextCard />` intro followed by a bento quadrant (one full-width card
 * on top, two below) — but tells the security/trust story. Built on the
 * shared `<Section />` / `<CardSection />` / `<MetalCard />` shells so its
 * rhythm matches every other themed marketing section.
 *
 * The quadrant cards carry only a title + description (no media well
 * content); `MetalCard`'s media well flex-grows to push the copy to the
 * cell floor, keeping titles bottom-aligned like the originals.
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
          headline="Built for Trust."
          subhead="AURA agents run in isolated virtual machines within trusted execution environments."
        />
      </Section>

      <CardSection ariaLabel="How AURA earns your trust">
        <MetalCard
          wide
          gradient={135}
          title="Isolated by default."
          description="Every AURA agent runs in its own sandboxed virtual machine, walled off from your system and from every other agent."
        />
        <MetalCard
          gradient={225}
          align="center"
          title="Trusted execution."
          description="Agents run inside hardware-backed trusted execution environments, so their memory and compute stay sealed end to end."
        />
        <MetalCard
          gradient={135}
          align="center"
          title="Verifiable end to end."
          description="Every environment is attested before it runs, so you can verify exactly what you are trusting before any work begins."
        />
      </CardSection>
    </>
  );
}
