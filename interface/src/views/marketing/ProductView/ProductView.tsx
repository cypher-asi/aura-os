import { type ReactNode, useEffect } from "react";
import { AgentChatSection } from "../AgentChatSection";
import { AgentConsole } from "../AgentConsole";
// Temporarily hidden: agent orb + marquee section.
// import { AgentOrbSection } from "../AgentOrbSection";
import { ChangelogPreview } from "../ChangelogPreview";
import { ExpertiseSection, ExpertiseTabs } from "../ExpertiseSection";
import { Section } from "../Section";
import {
  FeaturePanel,
  OpenSourceScene,
  PrivacyScene,
  SecureScene,
} from "../FeaturePanel/FeaturePanel";
import { CreateAgentButton } from "../../public-chat/CreateAgentButton";
import { TypewriterText } from "../../public-chat/TypewriterText";
import { MarketingFirstScreen } from "../MarketingFirstScreen";
import { MarketingFooter } from "../MarketingFooter";
import { CardSection, MetalCard } from "../CardSection";
import { MadeForYouSection } from "../MadeForYouSection";
import { ServiceDeviceCard } from "../PersonalAgentSection/ServiceDeviceCard";
import { PersonalAgentSection } from "../PersonalAgentSection";
import { BuiltForTrustSection } from "../BuiltForTrustSection";
import { SpecQuadrantSection } from "../SpecQuadrantSection";
import { PageHero } from "../PageHero";
import { ProductCallToAction } from "../ProductCallToAction";
import styles from "./ProductView.module.css";

/*
 * The hero copy is hoisted into a module-level constant because it
 * is referenced in TWO places that must stay byte-identical:
 *
 *   1. The `text` prop on `<TypewriterText />`, which drives the
 *      per-character reveal.
 *   2. The `data-text` attribute on the `.headlineReserve` wrapper,
 *      which the CSS rule mirrors into a `::before` ghost via
 *      `content: attr(data-text)` so the parent flex column reserves
 *      the FINAL headline's width/height from frame one. Without
 *      that reservation the description + headlineCta + flowing
 *      video below the headline would shift downward each time a
 *      newly-typed character forces an extra line wrap under the
 *      `clamp(26px, 4.3vw, 48px)` type ramp.
 *
 * Pulling the literal into a constant means a future copy change
 * cannot drift the ghost and the streamed text out of sync.
 */
const HERO_HEADLINE = "Delegate everything.";

/**
 * Marketing `/agents` page (formerly `/product`). A pure JSX
 * composition of the shared marketing components that tell the
 * agent story — hero, mobile-chat section, and the "Private by
 * Design" panel — plus the shared Changelog + Download footer. The
 * four product-screen sections (secure OS / swarm / autonomous
 * shipping / per-workflow process) moved to `CodeView` (`/code`).
 * Page-level chrome (titlebar / sidebar / scrollable column) is
 * owned by the public-mode `AuraShell` + `PublicMarketingPanel`, so
 * this component only renders the section stack.
 */
export function ProductView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Agents";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className={styles.productView}>
      <MarketingFirstScreen
        hero={
          <PageHero
            headline={
              <span
                className={styles.headlineReserve}
                data-text={HERO_HEADLINE}
              >
                <TypewriterText
                  text={HERO_HEADLINE}
                  speedMs={45}
                  showCaret={false}
                />
              </span>
            }
            description={
              <>
                AURA agents are experts in every field
                <br />
                and work while you sleep.
              </>
            }
            preview={null}
            centered
            headlineCta={<CreateAgentButton source="product_hero" />}
          />
        }
        stageHidden
        stageClassName={styles.consoleStage}
        stage={<AgentConsole />}
      />
      <MadeForYouSection />
      <CardSection ariaLabel="Build your agent">
        <MetalCard
          wide
          gradient={135}
          align="center"
          media={
            <div className="madeForYouDevice">
              <ServiceDeviceCard hexGrille />
            </div>
          }
        />
      </CardSection>
      <ExpertiseSection />
      <SpecQuadrantSection />
      <Section
        ariaLabel="Expertise areas"
        fullHeight={false}
        className="expertiseTabsSection"
      >
        <ExpertiseTabs />
      </Section>
      <PersonalAgentSection />
      <BuiltForTrustSection />
      <AgentChatSection />
      {/* Temporarily hidden: agent orb + marquee section.
      <AgentOrbSection /> */}
      <FeaturePanel
        headline="Private by Design."
        features={[
          {
            illustration: <PrivacyScene />,
            title: "Private",
            description:
              "AURA does not view or train on your personal or corporate data. Data sent to frontier model providers is not directly identifiable.",
            tag: "PRIVACY",
          },
          {
            illustration: <SecureScene />,
            title: "Secure",
            description:
              "The AURA harness and kernel is built from the ground up with security, verification and policy enforcement as first class citizens.",
            tag: "SECURITY",
          },
          {
            illustration: <OpenSourceScene />,
            title: "Open Source",
            description:
              "AURA is 100% open source under the MIT license. Fork it at anytime with zero vendor lock-in.",
            tag: "OPEN SOURCE",
          },
        ]}
      />
      <ChangelogPreview />
      <ProductCallToAction />
      <MarketingFooter />
    </div>
  );
}
