import { type ReactNode } from "react";
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
 * Bento cells — a thin full-width model marquee on top, then one
 * full-width quadrant and two below, each pairing a live mini-UI with
 * a title + description:
 *   0. Model marquee             -> every model from /models, looping
 *   1. "Always on"               -> the real chat input (mocked / static)
 *   2. "Intelligent in all domains" -> a sea of skills
 *   3. "Connected to everything" -> the services it connects to
 */
export function PersonalAgentSection(): ReactNode {
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
          headline="Multi-modal. Highly skilled."
          subhead="AURA is your own personal agent that supports you with everything from light tasks to deep work."
        />
      </Section>

      <CardSection ariaLabel="What your agent can do">
        <MetalCard
          wide
          gradient={180}
          className="paCardModelMarquee"
          media={<ModelMarquee />}
        />
        <MetalCard
          wide
          short
          gradient={135}
          className="paCardWide"
          media={<MockChatInputCard />}
          title="Always on."
          description="Ask or direct your agent to do almost anything. It will get to work and report back when necessary."
        />
        <MetalCard
          gradient={225}
          className="paCardSkills"
          align="center"
          media={<SkillSeaCard />}
          title="Intelligent in all domains."
          description="Your agent is a genius in all domains. It can help with the simple tasks of life, to creative projects, to advanced design and coding."
        />
        <MetalCard
          gradient={135}
          className="paCardServices"
          align="center"
          media={<ServiceDeviceCard />}
          title="Connected to everything."
          description="AURA securely connects to your services so it knows everything about you. Your data never leaves your own secure computer and is never trained on."
        />
      </CardSection>
    </>
  );
}
