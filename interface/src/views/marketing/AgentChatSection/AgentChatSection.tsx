import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PhoneShell } from "../PhoneShell";
import { ConnectedConsoleDevice } from "../ConnectedConsoleDevice";
import { Section } from "../Section";
import { CardSection, MetalCard } from "../CardSection";
import { MockMobileChat, MOBILE_CONVERSATIONS } from "../MockMobileChat";
import { AGENTS } from "../MockMobileChat/mobile-chat-script";
import { TextCard } from "../TextCard";
import "./AgentChatSection.css";

const HEADLINE_ID = "agentChatSectionHeadline";

/**
 * Mirrors the `ExpertiseSection` + `SpecQuadrantSection` and
 * `PersonalAgentSection` pairing: a compact H2 `<TextCard />` intro
 * section, then a separate bento section holding the content card.
 * Splitting them (rather than stacking both in one full-height
 * section) keeps the H2 block the exact same height as the other H2
 * intros and lets it center card-to-card between the bento above and
 * the bento below.
 *
 * The bento is a single wide `<MetalCard />` (like the spec content
 * quadrant) whose media well hosts the three phones and whose copy
 * block carries the "always on, from anywhere" writing block.
 *
 * Each `PhoneShell` hosts a `MockMobileChat` — a live, looping
 * mobile chat mockup showing the visitor texting one of their AURA
 * agents (your prompts on the right, the agent's typed replies and
 * streamed tool cards on the left). The three phones run three
 * distinct conversation flows from `MOBILE_CONVERSATIONS`, each
 * looping independently, mirroring the desktop landing hero but in
 * a phone-shaped messaging layout. The middle (hero) phone is
 * larger and lifted forward so it visually overlaps the two side
 * phones.
 *
 * On narrow viewports (<= 768px) `AgentChatSection.css` hides the
 * two side phones so only the centered hero phone remains, which
 * keeps the section legible on mobile without trying to squeeze a
 * desktop-style 3-phone row into a phone width.
 */
export function AgentChatSection(): ReactNode {
  const { t } = useTranslation("marketing");
  const [leftChat, centerChat, rightChat] = MOBILE_CONVERSATIONS;

  return (
    <>
      <Section
        ariaLabelledBy={HEADLINE_ID}
        fullHeight={false}
        className="agentChatIntro"
      >
        <TextCard
          level="h2"
          id={HEADLINE_ID}
          headline={
            <>
              {t("sections.agentChat.headlineLine1", {
                defaultValue: "Chat with your agents.",
              })}
              <br />
              {t("sections.agentChat.headlineLine2", {
                defaultValue: "From anywhere.",
              })}
            </>
          }
        />
      </Section>

      <CardSection
        ariaLabel={t("sections.agentChat.ariaLabel", {
          defaultValue: "Chat with your agents from anywhere",
        })}
      >
        <MetalCard
          wide
          transparent
          align="center"
          className="agentChatCard"
          description={t("sections.agentChat.description", {
            defaultValue:
              "Your AURA agents are always on. Pick up a conversation on your phone, your laptop, or your desktop. They remember everything and bring the same tools with them.",
          })}
          media={
            <div className="agentChatSectionStack">
              <div className="agentChatSectionPhones">
                <PhoneShell
                  size="md"
                  ariaLabel={t("sections.agentChat.phoneAriaLabel", {
                    defaultValue: `Mobile chat with the ${AGENTS[leftChat.agentId].name} agent`,
                    agentName: AGENTS[leftChat.agentId].name,
                  })}
                >
                  <MockMobileChat conversation={leftChat} />
                </PhoneShell>
                <PhoneShell
                  size="lg"
                  ariaLabel={t("sections.agentChat.phoneAriaLabel", {
                    defaultValue: `Mobile chat with the ${AGENTS[centerChat.agentId].name} agent`,
                    agentName: AGENTS[centerChat.agentId].name,
                  })}
                >
                  <MockMobileChat conversation={centerChat} />
                </PhoneShell>
                <PhoneShell
                  size="md"
                  ariaLabel={t("sections.agentChat.phoneAriaLabel", {
                    defaultValue: `Mobile chat with the ${AGENTS[rightChat.agentId].name} agent`,
                    agentName: AGENTS[rightChat.agentId].name,
                  })}
                >
                  <MockMobileChat conversation={rightChat} />
                </PhoneShell>
              </div>
              <ConnectedConsoleDevice />
            </div>
          }
        />
      </CardSection>
    </>
  );
}
