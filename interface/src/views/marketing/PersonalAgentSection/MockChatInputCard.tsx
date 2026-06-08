import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DesktopChatInputBar } from "../../../features/chat-ui/ChatInputBar";
import type { AgentMode } from "../../../constants/modes";

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
 *   - A controlled `input` value cycles through mode-specific example
 *     prompts with a lightweight typewriter effect.
 *   - The wrapper keeps the prompt read-only while allowing the mode
 *     selector to be clicked; picking a mode jumps to that mode's next
 *     example and the loop continues from there.
 */
interface MockExample {
  readonly mode: AgentMode;
  readonly prompt: string;
}

const MOCK_EXAMPLES: readonly MockExample[] = [
  {
    mode: "code",
    prompt: "Refactor this React component, update the tests, and open a PR",
  },
  {
    mode: "plan",
    prompt: "Plan a weekend trip to Lisbon and book the flights",
  },
  {
    mode: "image",
    prompt: "Generate a warm editorial photo of a tiny jungle library at dusk",
  },
  {
    mode: "video",
    prompt: "Turn these product screenshots into a 12 second launch video",
  },
  {
    mode: "3d",
    prompt: "Create a 3D model of a modular desk organizer with cable clips",
  },
  {
    mode: "plan",
    prompt: "Compare three daycares near me and schedule tours next week",
  },
  {
    mode: "code",
    prompt: "Find why this dashboard query times out and ship the fix",
  },
  {
    mode: "image",
    prompt: "Design a logo system for my neighborhood coffee side project",
  },
  {
    mode: "video",
    prompt: "Make a calm onboarding clip from this rough screen recording",
  },
  {
    mode: "3d",
    prompt: "Model a foldable travel tripod with labeled moving parts",
  },
  {
    mode: "plan",
    prompt: "Coordinate my cross-country move with movers, utilities, and flights",
  },
  {
    mode: "code",
    prompt: "Audit the auth flow for race conditions and write a migration plan",
  },
  {
    mode: "image",
    prompt: "Create campaign visuals for a luxury electric camper van in snow",
  },
  {
    mode: "video",
    prompt: "Storyboard and render a cinematic trailer for an AI music tool",
  },
  {
    mode: "3d",
    prompt: "Generate a game-ready spaceship cockpit with clean topology",
  },
  {
    mode: "plan",
    prompt: "Build a hiring plan for a five-person robotics research team",
  },
  {
    mode: "code",
    prompt: "Port this payment service to queues without dropping events",
  },
  {
    mode: "image",
    prompt: "Visualize a Mars greenhouse city for a science museum exhibit",
  },
  {
    mode: "video",
    prompt: "Create an investor demo video from this technical prototype",
  },
  {
    mode: "3d",
    prompt: "Design a manufacturable drone chassis with battery access",
  },
];

const TYPE_MS = 42;
const MODE_SELECT_MS = 80;
const MODE_SETTLE_MS = 180;
const HOLD_MS = 1600;
const START_MODE: AgentMode = "code";
const FIRST_EXAMPLE_INDEX = 1;

export function MockChatInputCard(): ReactNode {
  const [text, setText] = useState("");
  const [activeIndex, setActiveIndex] = useState(FIRST_EXAMPLE_INDEX);
  const [selectedMode, setSelectedMode] = useState<AgentMode>(START_MODE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jumpToMode = useCallback((mode: AgentMode) => {
    setSelectedMode(mode);
    setText("");
    setActiveIndex((current) => nextExampleIndexForMode(mode, current + 1));
  }, []);

  useEffect(() => {
    const example = MOCK_EXAMPLES[activeIndex];
    let cancelled = false;
    let typed = 0;

    const advance = () => {
      if (!cancelled) {
        setActiveIndex((current) => (current + 1) % MOCK_EXAMPLES.length);
      }
    };

    const tick = () => {
      if (cancelled) return;
      typed += 1;
      setText(example.prompt.slice(0, typed));
      if (typed < example.prompt.length) {
        timer.current = setTimeout(tick, TYPE_MS);
        return;
      }
      timer.current = setTimeout(advance, HOLD_MS);
    };

    setText("");
    timer.current = setTimeout(() => {
      if (cancelled) return;
      setSelectedMode(example.mode);
      timer.current = setTimeout(tick, MODE_SETTLE_MS);
    }, MODE_SELECT_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [activeIndex]);

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
          selectedModeOverride={selectedMode}
          onSelectedModeOverrideChange={jumpToMode}
          inputReadOnly
          attachAccent={<span aria-hidden="true" />}
        />
      </div>
    </Plate>
  );
}

function nextExampleIndexForMode(mode: AgentMode, startIndex: number): number {
  for (let offset = 0; offset < MOCK_EXAMPLES.length; offset += 1) {
    const index = (startIndex + offset) % MOCK_EXAMPLES.length;
    if (MOCK_EXAMPLES[index].mode === mode) return index;
  }
  return 0;
}
