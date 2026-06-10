import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "../Section";
import { CardSection, MetalCard } from "../CardSection";
import { TextCard } from "../TextCard";
import { TrustDeviceStage } from "./TrustDeviceStage";
import { PasswordLockDevice } from "./PasswordLockDevice";
import { AlwaysOnToggle } from "./AlwaysOnToggle";
import { VerifiedCubeScreen } from "./VerifiedCubeScreen";
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
 * The three copy cards carry a title + two-line description; `MetalCard`'s
 * media well flex-grows to push the copy to the cell floor, keeping titles
 * bottom-aligned across the row. The first card ("Always on.") seats the
 * glowing `AlwaysOnToggle` switch, the middle card ("Isolated by
 * default.") the animated `PasswordLockDevice`, and the last card
 * ("Trusted and verifiable.") the holographic `VerifiedCubeScreen` in
 * their media wells.
 */
export function BuiltForTrustSection(): ReactNode {
  const { t } = useTranslation("marketing");
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
          headline={t("sections.builtForTrust.headline", {
            defaultValue: "Built for trust.",
          })}
          subhead={t("sections.builtForTrust.subhead", {
            defaultValue:
              "AURA agents run in isolated virtual machines within trusted execution environments.",
          })}
        />
      </Section>

      <CardSection
        ariaLabel={t("sections.builtForTrust.ariaLabel", {
          defaultValue: "How AURA earns your trust",
        })}
        columns={3}
      >
        <MetalCard
          wide
          short
          gradient={135}
          className="builtForTrustDevice"
          media={<TrustDeviceStage />}
        />
        <MetalCard
          gradient={135}
          align="center"
          className="builtForTrustCopy"
          title={t("sections.builtForTrust.cards.alwaysOn.title", {
            defaultValue: "Always on.",
          })}
          description={t("sections.builtForTrust.cards.alwaysOn.description", {
            defaultValue:
              "Your agent keeps working around the clock, even while you're away and your devices are off.",
          })}
          media={<AlwaysOnToggle />}
        />
        <MetalCard
          gradient={225}
          align="center"
          className="builtForTrustCopy"
          title={t("sections.builtForTrust.cards.isolated.title", {
            defaultValue: "Isolated by default.",
          })}
          description={t("sections.builtForTrust.cards.isolated.description", {
            defaultValue:
              "Each agent runs in its own sandboxed VM, fully sealed off from your system and other agents.",
          })}
          media={<PasswordLockDevice />}
        />
        <MetalCard
          gradient={135}
          align="center"
          className="builtForTrustCopy"
          title={t("sections.builtForTrust.cards.verifiable.title", {
            defaultValue: "Trusted and verifiable.",
          })}
          description={t("sections.builtForTrust.cards.verifiable.description", {
            defaultValue:
              "Every environment is attested before it runs, so you can always verify what you're trusting.",
          })}
          media={<VerifiedCubeScreen />}
        />
      </CardSection>
    </>
  );
}
