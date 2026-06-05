import { type ReactNode } from "react";
import { Section } from "../Section";
import "./OneComputerOneAgentSection.css";

const HEADLINE_ID = "oneComputerOneAgentHeadline";

/**
 * Marketing section that sits between the agents hero
 * (`MarketingFirstScreen`) and the agent-chat section
 * (`AgentChatSection`) on the `/agents` page. Built on the shared
 * `<Section />` shell so its outer rhythm (background tint, padding,
 * viewport-height reservation, column cap) matches every other themed
 * marketing section.
 *
 * A single centered headline — "1 COMPUTER = 1 AGENT" — with the neon
 * terminal artwork stacked directly underneath it.
 */
export function OneComputerOneAgentSection(): ReactNode {
  return (
    <Section ariaLabelledBy={HEADLINE_ID}>
      <div className="oneComputerOneAgentInner">
        <h2 id={HEADLINE_ID} className="oneComputerOneAgentHeadline">
          1 COMPUTER = 1 AGENT
        </h2>
        <img
          className="oneComputerOneAgentImage"
          src="/one-computer-one-agent.png"
          alt="A neon outline of a personal computer"
          width={1024}
          height={768}
          loading="lazy"
        />
      </div>
    </Section>
  );
}
