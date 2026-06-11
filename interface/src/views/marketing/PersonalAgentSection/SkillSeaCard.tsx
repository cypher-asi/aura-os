import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plate } from "../../../components/Plate";
import { SkillIcon } from "../../../components/SkillShopModal/SkillIcon";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";

/**
 * Mini-UI for the "Intelligent in all domains" quadrant: the shared
 * three-ringed `Plate` panel (matching the chat capsule and service
 * device) holding the skills as raised neomorphic keycaps, grouped into
 * sections by hairline divider lines like a hardware controller. Each
 * key is an icon-only square keycap with an embossed inner circle behind
 * a real `SkillIcon` glyph (resolved from the skill id); a few featured
 * skills are "lit" with a warm accent fill, echoing the active keys on
 * the reference macro-pad device.
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

/** How long a tapped keycap glows the golden accent before settling back. */
const FLASH_MS = 1500;

export function SkillSeaCard(): ReactNode {
  const { t } = useTranslation("marketing");
  // Mobile collapses the three divider-separated groups into a single tidy
  // 4x4 keypad (the mobile section CSS lays a group out as `repeat(4, 1fr)`,
  // so one 16-key group reads as 4 across x 4 down with no dividers).
  const { isMobileLayout } = useAuraCapabilities();
  const groups = isMobileLayout
    ? [SKILL_GROUPS.flat().slice(0, 16)]
    : SKILL_GROUPS;
  // Which keycap is currently playing its gold click-flash, keyed by skill id.
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashKey = useCallback((id: string) => {
    setFlashedId(id);
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => {
      setFlashedId((current) => (current === id ? null : current));
    }, FLASH_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  return (
    <Plate className="personalAgentSkillPlate" aria-hidden="true">
      <div className="personalAgentSkillPanel">
        <div className="personalAgentSkillWell">
          {groups.map((group, groupIndex) => (
            <Fragment key={groupIndex}>
              {groupIndex > 0 && (
                <span className="personalAgentSkillDivider" />
              )}
              <div className="personalAgentSkillSection">
                {group.map((skill) => {
                  const skillLabel = t(`skills.${skill.id}`, {
                    defaultValue: skill.label,
                  });
                  return (
                  <div key={skill.id} className="personalAgentSkillSocket">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="personalAgentSkillBtn"
                      data-lit={skill.lit ? "true" : undefined}
                      data-flash={flashedId === skill.id ? "true" : undefined}
                      aria-label={skillLabel}
                      title={skillLabel}
                      onClick={() => flashKey(skill.id)}
                    >
                      <SkillIcon name={skill.id} size={20} />
                    </button>
                  </div>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </Plate>
  );
}
