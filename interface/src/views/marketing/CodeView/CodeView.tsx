import { type ReactNode, useEffect } from "react";
import { CardSection, MetalCard } from "../CardSection";
import { ChangelogPreview } from "../ChangelogPreview";
import { MarketingFirstScreen } from "../MarketingFirstScreen";
import { MarketingFooter } from "../MarketingFooter";
import { MockAuraDesktop } from "../MockAuraDesktop";
import { PageHero } from "../PageHero";
import { ProductCallToAction } from "../ProductCallToAction";
import { CreateAgentButton } from "../../public-chat/CreateAgentButton";
import { TypewriterText } from "../../public-chat/TypewriterText";
import styles from "./CodeView.module.css";

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
 *      that reservation the description + headlineCta + mock desktop
 *      below the headline would shift downward each time a
 *      newly-typed character forces an extra line wrap under the
 *      `clamp(26px, 4.3vw, 48px)` type ramp.
 *
 * Pulling the literal into a constant means a future copy change
 * cannot drift the ghost and the streamed text out of sync.
 */
const HERO_HEADLINE = "Code while you sleep.";

/**
 * Marketing `/code` page. Adopts the Agents page's section language: a
 * centered `PageHero` followed by `CardSection` / `MetalCard` panels.
 * The hero is trailed by a single wide metal card whose media is a
 * faithful, interactive mock of the authenticated AURA desktop shell
 * (`MockAuraDesktop`) — titlebar, agents/projects nav, a center LLM
 * chat, a half-width sidekick that scripts a Terminal-to-Tasks loop, and
 * the bottom taskbar — built by reusing the app's real presentational
 * components fed hardcoded data, so the page previews the real logged-in
 * experience. The mock sits on the same diagonal "metal" gradient panel
 * the Agents page uses for its hero device and bento cards.
 *
 * Page chrome (titlebar / sidebar / scrollable column) is owned by the
 * public-mode `AuraShell` + `PublicMarketingPanel`, so this component
 * only renders the section stack.
 */
export function CodeView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Code";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className={styles.codeView}>
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
            description="A frontier coding harness designed for security, automation and verifiability that is 100% open source."
            preview={null}
            centered
            headlineCta={<CreateAgentButton source="code_hero" />}
          />
        }
      />
      <CardSection ariaLabel="The AURA coding desktop">
        <MetalCard
          wide
          gradient={135}
          align="center"
          className={styles.mockDesktopCard}
          media={
            <div className={styles.mockDesktopHolder} aria-hidden="true">
              <MockAuraDesktop />
            </div>
          }
        />
      </CardSection>
      <ChangelogPreview />
      <ProductCallToAction />
      <MarketingFooter />
    </div>
  );
}
