import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { SkillIcon } from "../../../components/SkillShopModal/SkillIcon";

/**
 * Mini-UI for the "Intelligent in all domains" quadrant: the shared
 * three-ringed `Plate` panel (matching the chat capsule and service
 * device) holding the skills as raised neomorphic buttons, grouped into
 * sections by hairline divider lines like a hardware controller. Each
 * button pairs a real `SkillIcon` glyph (resolved from the skill id)
 * with a short label; a few featured skills are "lit" with an accent
 * fill and an LED dot, echoing the active keys on the reference device.
 *
 * Everything here is decorative (`aria-hidden`) — it sells the breadth
 * of skills visually rather than acting as a real control surface.
 */
interface SkillButton {
  readonly id: string;
  readonly label: string;
  readonly lit?: boolean;
}

const SKILL_GROUPS: readonly (readonly SkillButton[])[] = [
  [
    { id: "coding-agent", label: "Code", lit: true },
    { id: "skill-creator", label: "Create" },
    { id: "gifgrep", label: "Images" },
    { id: "video-frames", label: "Video" },
    { id: "nano-pdf", label: "PDFs" },
    { id: "summarize", label: "Summarize" },
  ],
  [
    { id: "github", label: "GitHub" },
    { id: "slack", label: "Slack", lit: true },
    { id: "notion", label: "Notes" },
    { id: "discord", label: "Discord" },
    { id: "trello", label: "Boards" },
    { id: "himalaya", label: "Email" },
  ],
  [
    { id: "taskflow", label: "Tasks" },
    { id: "goplaces", label: "Maps" },
    { id: "openhue", label: "Lights" },
    { id: "spotify-player", label: "Music" },
    { id: "voice-call", label: "Call", lit: true },
    { id: "healthcheck", label: "Health" },
  ],
];

export function SkillSeaCard(): ReactNode {
  return (
    <Plate className="personalAgentSkillPlate" aria-hidden="true">
      <div className="personalAgentSkillPanel">
        <div className="personalAgentSkillWell">
          {SKILL_GROUPS.map((group, groupIndex) => (
            <div key={groupIndex} className="personalAgentSkillSectionWrap">
              {groupIndex > 0 && (
                <span className="personalAgentSkillDivider" />
              )}
              <div className="personalAgentSkillSection">
                {group.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    tabIndex={-1}
                    className="personalAgentSkillBtn"
                    data-lit={skill.lit ? "true" : undefined}
                  >
                    {skill.lit && <span className="personalAgentSkillLed" />}
                    <SkillIcon name={skill.id} size={16} />
                    <span className="personalAgentSkillBtnLabel">
                      {skill.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Plate>
  );
}
