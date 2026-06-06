import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DesktopChatInputBar } from "../../../features/chat-ui/ChatInputBar";
import { AuraScreenOrb } from "../AuraScreenOrb";

/**
 * Mini-UI for the "Always ready" quadrant. Reuses the REAL authenticated
 * chat input (`DesktopChatInputBar`) so the marketing page shows the
 * exact pill / mode bar / send affordances a user gets in-app, then
 * drives it as a non-interactive display:
 *
 *   - `isStatic` flips the bar into its presentational mode.
 *   - `machineType="local"` with no `agentId` / `workspacePath` keeps
 *     the agent-environment + project-file hooks idle, so the bar makes
 *     no network calls on the public route.
 *   - A controlled `input` value cycles through example prompts with a
 *     lightweight typewriter effect, so the bar reads as someone asking
 *     the agent different questions.
 *   - The wrapper is `pointer-events: none` (see CSS) so nothing in the
 *     bar is clickable on the marketing surface.
 */
const PROMPTS: readonly string[] = [
  "Plan a weekend trip to Lisbon and book the flights",
  "Summarize my unread Slack threads from today",
  "Refactor this React component and open a PR",
  "Draft a birthday message for my mom",
  "Design a logo for my coffee side-project",
];

const TYPE_MS = 55;
const ERASE_MS = 22;
const HOLD_MS = 1600;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function MockChatInputCard(): ReactNode {
  // Seed with the first prompt when motion is reduced so the bar never
  // animates; otherwise start empty and let the effect type it in.
  const [text, setText] = useState(() =>
    prefersReducedMotion() ? PROMPTS[0] : "",
  );
  const promptIndex = useRef(0);
  const charIndex = useRef(0);
  const phase = useRef<"typing" | "holding" | "erasing">("typing");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    const tick = () => {
      const prompt = PROMPTS[promptIndex.current];

      if (phase.current === "typing") {
        charIndex.current += 1;
        setText(prompt.slice(0, charIndex.current));
        if (charIndex.current >= prompt.length) {
          phase.current = "holding";
          timer.current = setTimeout(tick, HOLD_MS);
          return;
        }
        timer.current = setTimeout(tick, TYPE_MS);
        return;
      }

      if (phase.current === "holding") {
        phase.current = "erasing";
        timer.current = setTimeout(tick, ERASE_MS);
        return;
      }

      charIndex.current -= 1;
      setText(prompt.slice(0, Math.max(0, charIndex.current)));
      if (charIndex.current <= 0) {
        phase.current = "typing";
        promptIndex.current = (promptIndex.current + 1) % PROMPTS.length;
      }
      timer.current = setTimeout(tick, ERASE_MS);
    };

    timer.current = setTimeout(tick, TYPE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <Plate radius="999px" className="personalAgentChatMock">
      <div className="personalAgentChatMockContent">
        <DesktopChatInputBar
          input={text}
          onInputChange={() => {}}
          onSend={() => {}}
          onStop={() => {}}
          streamKey="marketing-personal-agent"
          machineType="local"
          agentName="AURA"
          isStatic
          attachAccent={<AuraScreenOrb />}
        />
      </div>
    </Plate>
  );
}
