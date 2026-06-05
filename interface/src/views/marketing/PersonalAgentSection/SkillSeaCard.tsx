import { type ReactNode } from "react";
import { SkillIcon } from "../../../components/SkillShopModal/SkillIcon";

/**
 * Mini-UI for the "Intelligent in all domains" quadrant: a dense
 * "sea" of skill chips drawn from the real `SkillIcon` map. The chips
 * pack into a center-justified flow and fade out at the card edges via
 * a CSS mask, so the grid reads as an endless field of capabilities
 * rather than a fixed list.
 *
 * Each entry pairs a skill id (resolved to its lucide glyph by
 * `SkillIcon`) with a short human label.
 */
interface SkillChip {
  readonly id: string;
  readonly label: string;
}

const SKILLS: readonly SkillChip[] = [
  { id: "coding-agent", label: "Code" },
  { id: "weather", label: "Weather" },
  { id: "spotify-player", label: "Music" },
  { id: "notion", label: "Notes" },
  { id: "github", label: "GitHub" },
  { id: "slack", label: "Slack" },
  { id: "summarize", label: "Summarize" },
  { id: "voice-call", label: "Call" },
  { id: "taskflow", label: "Tasks" },
  { id: "gifgrep", label: "Images" },
  { id: "healthcheck", label: "Health" },
  { id: "goplaces", label: "Maps" },
  { id: "oracle", label: "Reason" },
  { id: "ordercli", label: "Shop" },
  { id: "openhue", label: "Lights" },
  { id: "blogwatcher", label: "Feeds" },
  { id: "sag", label: "Browse" },
  { id: "himalaya", label: "Email" },
  { id: "things-mac", label: "To-dos" },
  { id: "video-frames", label: "Video" },
  { id: "nano-pdf", label: "PDFs" },
  { id: "openai-whisper", label: "Transcribe" },
  { id: "sherpa-onnx-tts", label: "Speak" },
  { id: "trello", label: "Boards" },
  { id: "1password", label: "Secrets" },
  { id: "peekaboo", label: "Vision" },
  { id: "apple-reminders", label: "Reminders" },
  { id: "skill-creator", label: "New Skills" },
  { id: "discord", label: "Discord" },
  { id: "songsee", label: "Lyrics" },
  { id: "model-usage", label: "Usage" },
  { id: "obsidian", label: "Vault" },
];

export function SkillSeaCard(): ReactNode {
  return (
    <div className="personalAgentSkillSea" aria-hidden="true">
      <div className="personalAgentSkillSeaInner">
        {SKILLS.map((skill) => (
          <span key={skill.id} className="personalAgentSkillChip">
            <SkillIcon name={skill.id} size={16} />
            {skill.label}
          </span>
        ))}
      </div>
    </div>
  );
}
