import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "../Section";
import { TextCard } from "../TextCard";
import "./MadeForYouSection.css";

const HEADLINE_ID = "madeForYouSectionHeadline";

/**
 * Marketing section that sits directly above the "Expertise without ego."
 * intro (`ExpertiseSection`) on the `/agents` page. Renders the shared
 * `<TextCard />` in its `h2` size inside the `<Section />` shell, opting
 * OUT of the shell's full-viewport reservation so this intro reads as a
 * peer of the hero text area rather than floating in a full empty screen.
 */
export function MadeForYouSection(): ReactNode {
  const { t } = useTranslation("marketing");
  return (
    <Section
      ariaLabelledBy={HEADLINE_ID}
      fullHeight={false}
      className="madeForYouSection"
    >
      <TextCard
        level="h2"
        id={HEADLINE_ID}
        headline={t("sections.madeForYou.headline", {
          defaultValue: "Agents made for you.",
        })}
        subhead={t("sections.madeForYou.subhead", {
          defaultValue: "Design and launch your agent in 30 seconds.",
        })}
      />
    </Section>
  );
}
