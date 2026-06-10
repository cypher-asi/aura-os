import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "../Section";
import { CardSection, MetalCard } from "../CardSection";
import { TextCard } from "../TextCard";
import { MockChatInputCard } from "./MockChatInputCard";
import { ModelMarquee } from "./ModelMarquee";
import { ServiceDeviceCard } from "./ServiceDeviceCard";
import { SkillSeaCard } from "./SkillSeaCard";
import "./PersonalAgentSection.css";

const HEADLINE_ID = "personalAgentHeadline";

/**
 * Marketing section that sits after the agents hero
 * (`MarketingFirstScreen`, which hosts the `AgentMarquee` card row) and
 * before the agent-chat section (`AgentChatSection`) on the `/agents`
 * page. Built on the shared `<Section />` shell so its outer rhythm
 * matches every other themed marketing section.
 *
 * Mirrors the `ExpertiseSection` + `SpecQuadrantSection` pairing: a
 * compact H2 `<TextCard />` intro section, then a separate bento section
 * holding the three-quadrant grid. Splitting them (rather than stacking
 * both in one full-height section with a large gap) keeps the H2 block
 * the exact same height as the other H2 intros and lets it center
 * card-to-card between the bento above and the bento below.
 *
 * Bento cells — one full-width quadrant on top and two below, each
 * pairing a live mini-UI with a title + description:
 *   1. "Always on"               -> the real chat input (mocked / static),
 *        with the looping model marquee pinned across the card's top edge
 *   2. "Intelligent in all domains" -> a sea of skills
 *   3. "Connected to everything" -> the services it connects to
 */
export function PersonalAgentSection(): ReactNode {
  const { t } = useTranslation("marketing");
  return (
    <>
      <Section
        ariaLabelledBy={HEADLINE_ID}
        fullHeight={false}
        className="personalAgentIntro"
      >
        <TextCard
          level="h2"
          id={HEADLINE_ID}
          headline={t("sections.personalAgent.headline", {
            defaultValue: "Every model. Every mode.",
          })}
          subhead={t("sections.personalAgent.subhead", {
            defaultValue:
              "AURA is your own personal agent that supports you with everything from light tasks to deep work.",
          })}
        />
      </Section>

      <CardSection
        ariaLabel={t("sections.personalAgent.ariaLabel", {
          defaultValue: "What your agent can do",
        })}
      >
        <MetalCard
          wide
          gradient={135}
          className="paCardWide"
          mediaClassName="paAlwaysOnMediaWell"
          media={
            <>
              <div className="paAlwaysOnMarquee">
                <ModelMarquee />
              </div>
              <div className="paAlwaysOnChat">
                <MockChatInputCard />
              </div>
            </>
          }
          title={t("sections.personalAgent.cards.alwaysOn.title", {
            defaultValue: "Always on.",
          })}
          description={t("sections.personalAgent.cards.alwaysOn.description", {
            defaultValue:
              "Ask or direct your agent to do almost anything. It will get to work and report back when necessary.",
          })}
        />
        <MetalCard
          gradient={225}
          className="paCardSkills"
          align="center"
          media={<SkillSeaCard />}
          title={t("sections.personalAgent.cards.domains.title", {
            defaultValue: "Intelligent in all domains.",
          })}
          description={t("sections.personalAgent.cards.domains.description", {
            defaultValue:
              "Your agent is a genius in all domains. It can help with the simple tasks of life, to creative projects, to advanced design and coding.",
          })}
        />
        <MetalCard
          gradient={135}
          className="paCardServices"
          align="center"
          media={<ServiceDeviceCard />}
          title={t("sections.personalAgent.cards.connected.title", {
            defaultValue: "Connected to everything.",
          })}
          description={t("sections.personalAgent.cards.connected.description", {
            defaultValue:
              "AURA securely connects to your services so it knows everything about you. Your data never leaves your own secure computer and is never trained on.",
          })}
        />
      </CardSection>
    </>
  );
}
