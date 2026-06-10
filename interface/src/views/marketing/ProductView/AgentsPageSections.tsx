import { type ReactNode } from "react";
import { AgentChatSection } from "../AgentChatSection";
import { AgentConsole } from "../AgentConsole";
import { ChangelogPreview } from "../ChangelogPreview";
import { ExpertiseSection } from "../ExpertiseSection";
import { PrivacyFeaturePanel } from "../PrivacyFeaturePanel";
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
 * The full `/agents` marketing section stack — hero + `AgentConsole`
 * stage through the shared footer — extracted from `ProductView` so
 * it can render in TWO places:
 *
 *   1. `ProductView` (`/agents`) wraps it with the page `document.title`
 *      effect, exactly as before.
 *   2. `PublicChatView` (`/`) embeds it below the persona-carousel hero
 *      so wheeling past the last persona scrolls seamlessly into the
 *      agents story without a route change.
 *
 * The `.productView` wrapper class MUST stay on this component (not on
 * the route shell): it carries `--marketing-section-bg` and the
 * text-color custom properties every section below reads, so wherever
 * this stack mounts it brings its own dark surface tokens with it.
 */
export function AgentsPageSections(): ReactNode {
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
                that work while you sleep.
              </>
            }
            preview={null}
            centered
            headlineCta={<CreateAgentButton source="product_hero" />}
          />
        }
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
      <PersonalAgentSection />
      <ExpertiseSection />
      <SpecQuadrantSection />
      <BuiltForTrustSection />
      <AgentChatSection />
      <PrivacyFeaturePanel />
      <ChangelogPreview />
      <ProductCallToAction />
      <MarketingFooter />
    </div>
  );
}

export default AgentsPageSections;
