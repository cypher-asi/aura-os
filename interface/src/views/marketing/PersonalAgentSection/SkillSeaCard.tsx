import { Fragment, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { SkillIcon } from "../../../components/SkillShopModal/SkillIcon";

/**
 * Mini-UI for the "Intelligent in all domains" quadrant: the shared
 * three-ringed `Plate` panel (matching the chat capsule and service
 * device) holding the skills as raised neomorphic keycaps, grouped into
 * sections by hairline divider lines like a hardware controller. Each
 * key is an icon-only square keycap with an embossed inner circle behind
 * a real `SkillIcon` glyph (resolved from the skill id); a few featured
 * skills are "lit" with an accent fill and an LED dot, echoing the active
 * keys on the reference macro-pad device.
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
            <Fragment key={groupIndex}>
              {groupIndex > 0 && (
                <span className="personalAgentSkillDivider" />
              )}
              <div className="personalAgentSkillSection">
                {group.map((skill) => (
                  <div key={skill.id} className="personalAgentSkillSocket">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="personalAgentSkillBtn"
                      data-lit={skill.lit ? "true" : undefined}
                      aria-label={skill.label}
                      title={skill.label}
                    >
                      {skill.lit && <span className="personalAgentSkillLed" />}
                      <SkillIcon name={skill.id} size={20} />
                    </button>
                  </div>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </Plate>
  );
}
