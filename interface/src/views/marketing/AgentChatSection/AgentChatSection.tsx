import { type ReactNode } from "react";
import { PhoneShell } from "../PhoneShell";
import { Section } from "../Section";
import { MockMobileChat, MOBILE_CONVERSATIONS } from "../MockMobileChat";
import { AGENTS } from "../MockMobileChat/mobile-chat-script";
import { TextCard } from "../TextCard";
import "./AgentChatSection.css";

const HEADLINE_ID = "agentChatSectionHeadline";

/**
 * First themed section built on the shared marketing `<Section />`
 * shell. Mirrors the Apple iPhone 17 hero layout: a centered
 * headline at the top, three phones below it (the middle one
 * larger and lifted forward so it visually overlaps the two side
 * phones), and a writing block at the bottom.
 *
 * Each `PhoneShell` hosts a `MockMobileChat` — a live, looping
 * mobile chat mockup showing the visitor texting one of their AURA
 * agents (your prompts on the right, the agent's typed replies and
 * streamed tool cards on the left). The three phones run three
 * distinct conversation flows from `MOBILE_CONVERSATIONS`, each
 * looping independently, mirroring the desktop landing hero but in
 * a phone-shaped messaging layout.
 *
 * On narrow viewports (<= 768px) `AgentChatSection.css` hides the
 * two side phones so only the centered hero phone remains, which
 * keeps the section legible on mobile without trying to squeeze a
 * desktop-style 3-phone row into a phone width.
 */
export function AgentChatSection(): ReactNode {
  const [leftChat, centerChat, rightChat] = MOBILE_CONVERSATIONS;

  return (
    <Section ariaLabelledBy={HEADLINE_ID} className="agentChatSection">
      <div className="agentChatSectionInner">
        <TextCard
          level="h2"
          id={HEADLINE_ID}
          className="agentChatSectionHeadlineCard"
          headline={
            <>
              Chat with your agents.
              <br />
              From anywhere.
            </>
          }
        />
        <div className="agentChatSectionPhones">
          <PhoneShell
            size="md"
            ariaLabel={`Mobile chat with the ${AGENTS[leftChat.agentId].name} agent`}
          >
            <MockMobileChat conversation={leftChat} />
          </PhoneShell>
          <PhoneShell
            size="lg"
            ariaLabel={`Mobile chat with the ${AGENTS[centerChat.agentId].name} agent`}
          >
            <MockMobileChat conversation={centerChat} />
          </PhoneShell>
          <PhoneShell
            size="md"
            ariaLabel={`Mobile chat with the ${AGENTS[rightChat.agentId].name} agent`}
          >
            <MockMobileChat conversation={rightChat} />
          </PhoneShell>
        </div>
        <p className="agentChatSectionDescription">
          Your AURA agents are always on. Pick up a conversation on
          your phone, your laptop, or your desktop — they remember
          everything and bring the same tools with them, wherever
          you are.
        </p>
      </div>
    </Section>
  );
}
