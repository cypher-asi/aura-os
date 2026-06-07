import { type ReactNode, useEffect } from "react";
import { ChangelogPreview } from "../ChangelogPreview";
import { MarketingFirstScreen } from "../MarketingFirstScreen";
import { MarketingFooter } from "../MarketingFooter";
import { MockAuraDesktop } from "../MockAuraDesktop";
import { PageHero } from "../PageHero";
import { ProductCallToAction } from "../ProductCallToAction";
import { CreateAgentButton } from "../../public-chat/CreateAgentButton";
import styles from "./CodeView.module.css";

/**
 * Marketing `/code` page. Mirrors the public landing's "hero text on
 * top, mock desktop below" structure (and the Agents page's centered
 * `PageHero`), but the desktop is a faithful, static mock of the
 * authenticated AURA desktop shell (`MockAuraDesktop`) — titlebar,
 * project sidebar, Projects/Execution work surface, sidekick rail, and
 * bottom taskbar — built by reusing the app's real presentational
 * components fed hardcoded data, so the page previews the real
 * logged-in experience.
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
            headline="Code while you sleep."
            description="A frontier coding harness designed for security, automation and verifiability that is 100% open source."
            preview={null}
            centered
            headlineCta={<CreateAgentButton source="code_hero" />}
          />
        }
        stageClassName={styles.desktopStage}
        stageHidden
        stage={<MockAuraDesktop />}
      />
      <ChangelogPreview />
      <ProductCallToAction />
      <MarketingFooter />
    </div>
  );
}
