import { type ReactNode } from "react";
import { Section } from "../Section";
import { MockChatInputCard } from "./MockChatInputCard";
import { ServiceGridCard } from "./ServiceGridCard";
import { SkillSeaCard } from "./SkillSeaCard";
import "./PersonalAgentSection.css";

const HEADLINE_ID = "personalAgentHeadline";

/**
 * Marketing section that sits between the agents hero
 * (`MarketingFirstScreen`, which hosts the `AgentMarquee` card row) and
 * the "1 COMPUTER = 1 AGENT" section (`OneComputerOneAgentSection`) on
 * the `/agents` page. Built on the shared `<Section />` shell so its
 * outer rhythm matches every other themed marketing section.
 *
 * Centered headline + subhead, then a three-quadrant bento grid: one
 * full-width quadrant on top and two below, each pairing a live mini-UI
 * with a title + description:
 *   1. "Always ready"            -> the real chat input (mocked / static)
 *   2. "Intelligent in all domains" -> a sea of skills
 *   3. "Designed for you"        -> the services it connects to
 */
export function PersonalAgentSection(): ReactNode {
  return (
    <Section ariaLabelledBy={HEADLINE_ID}>
      <div className="personalAgentInner">
        <header className="personalAgentHead">
          <h2 id={HEADLINE_ID} className="personalAgentHeadline">
            An agent for work, love, play.
          </h2>
          <p className="personalAgentSubhead">
            AURA is your own personal agent that supports you with
            everything from light tasks to deep work. It&rsquo;s designed
            for you, available and in service.
          </p>
        </header>

        <div className="personalAgentGrid">
          <article className="personalAgentQuadrant personalAgentQuadrantWide">
            <div className="personalAgentMedia personalAgentMediaChat">
              <MockChatInputCard />
            </div>
            <div className="personalAgentCopy">
              <h3 className="personalAgentQuadrantTitle">Always ready.</h3>
              <p className="personalAgentQuadrantDesc">
                Your agent is available for any task. Simply message it
                from any of your favorite messaging apps and it starts
                working for you.
              </p>
            </div>
          </article>

          <article className="personalAgentQuadrant">
            <div className="personalAgentMedia">
              <SkillSeaCard />
            </div>
            <div className="personalAgentCopy">
              <h3 className="personalAgentQuadrantTitle">
                Intelligent in all domains.
              </h3>
              <p className="personalAgentQuadrantDesc">
                Your agent is a genius in all domains. It can help with
                the simple tasks of life, to creative projects, to
                advanced design and coding.
              </p>
            </div>
          </article>

          <article className="personalAgentQuadrant">
            <div className="personalAgentMedia">
              <ServiceGridCard />
            </div>
            <div className="personalAgentCopy">
              <h3 className="personalAgentQuadrantTitle">Designed for you.</h3>
              <p className="personalAgentQuadrantDesc">
                AURA securely connects to your services so it knows
                everything about you. Your data never leaves your own
                secure computer and is never trained on.
              </p>
            </div>
          </article>
        </div>
      </div>
    </Section>
  );
}
