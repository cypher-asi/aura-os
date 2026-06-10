import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "../Section";
import { TextCard } from "../TextCard";
import "./ExpertiseSection.css";

const HEADLINE_ID = "expertiseSectionHeadline";

/**
 * Marketing section that sits directly below the `/agents` hero
 * (`MarketingFirstScreen`) and above the "An agent designed for you."
 * bento (`PersonalAgentSection`). Renders the shared `<TextCard />` in
 * its `h2` size (25% shorter than the hero-height `h1` card) inside the
 * `<Section />` shell, opting OUT of the shell's full-viewport
 * reservation so this intro reads as a peer of the top hero text area
 * rather than floating in a full empty screen.
 */
export function ExpertiseSection(): ReactNode {
  const { t } = useTranslation("marketing");
  return (
    <Section
      ariaLabelledBy={HEADLINE_ID}
      fullHeight={false}
      className="expertiseSection"
    >
      <TextCard
        level="h2"
        id={HEADLINE_ID}
        headline={t("sections.expertise.headline", {
          defaultValue: "Expertise without ego.",
        })}
        subhead={
          <>
            {t("sections.expertise.subheadLine1", {
              defaultValue: "AURA agents are experts in every discipline.",
            })}
            <br />
            {t("sections.expertise.subheadLine2", {
              defaultValue: "From coding to science to creativity.",
            })}
          </>
        }
      />
    </Section>
  );
}
