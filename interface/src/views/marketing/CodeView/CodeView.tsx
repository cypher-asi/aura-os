import { type ReactNode, useEffect } from "react";
import { ChangelogPreview } from "../ChangelogPreview";
import { MarketingFirstScreen } from "../MarketingFirstScreen";
import { MarketingFooter } from "../MarketingFooter";
import { MockProjectsWorkspace } from "../MockProjectsWorkspace";
import { PageHero } from "../PageHero";
import { ProductCallToAction } from "../ProductCallToAction";
import { CreateAgentButton } from "../../public-chat/CreateAgentButton";
import { MockAuraApp } from "../../public-chat/MockAuraApp";
import styles from "./CodeView.module.css";

/**
 * Marketing `/code` page. Mirrors the public landing's "hero text on
 * top, mock desktop below" structure (and the Agents page's centered
 * `PageHero`), but the desktop reuses the shared `MockAuraApp` chrome
 * (titlebar + bottom taskbar + wallpaper) with its center content
 * swapped from the scripted DM windows to a static
 * `MockProjectsWorkspace` — a mock of the app's Projects workspace.
 *
 * This pass locks the layout; the hero copy and the workspace content
 * are intentionally placeholders to be refined next. Page chrome
 * (titlebar / sidebar / scrollable column) is owned by the
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
            headline="Ship software while you sleep."
            description="A frontier coding harness designed for security, automation and verifiability that is 100% open source."
            preview={null}
            centered
            headlineCta={<CreateAgentButton source="code_hero" />}
          />
        }
        stageClassName={styles.desktopStage}
        stageHidden
        stage={
          <MockAuraApp
            desktopBackgroundUrl="/personas/vibecoder/desktop.png"
            centerContent={<MockProjectsWorkspace />}
          />
        }
      />
      <ChangelogPreview />
      <ProductCallToAction />
      <MarketingFooter />
    </div>
  );
}
