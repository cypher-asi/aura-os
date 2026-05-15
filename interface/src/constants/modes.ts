import type { GenerationMode } from "./models";

export type AgentMode = "code" | "plan" | "image" | "3d" | "video";

export const DEFAULT_AGENT_MODE: AgentMode = "code";

export const AGENT_MODE_ORDER: readonly AgentMode[] = [
  "code",
  "plan",
  "image",
  "video",
  "3d",
];

export type HarnessAction = "generate_specs";

/**
 * Discriminated union describing how a mode steers a send. Each
 * variant lists ONLY the fields that variant actually uses, so the
 * compiler (and callers) can never accidentally read an irrelevant
 * field (e.g. an `action` on Image mode). `chat` is the explicit
 * "no override" value; we never use `null` / `undefined` for these
 * fields anywhere downstream.
 */
export type AgentModeBehavior =
  | { kind: "chat" }
  | { kind: "chat_with_action"; action: HarnessAction }
  | { kind: "generate_image"; commandId: "generate_image" }
  | { kind: "generate_3d"; commandId: "generate_3d" }
  | { kind: "generate_video"; commandId: "generate_video" };

export interface AgentModeDescriptor {
  mode: AgentMode;
  label: string;
  description: string;
  behavior: AgentModeBehavior;
}

export const AGENT_MODE_DESCRIPTORS: Record<AgentMode, AgentModeDescriptor> = {
  code: {
    mode: "code",
    label: "Code",
    description: "Standard coding assistant",
    behavior: { kind: "chat" },
  },
  plan: {
    mode: "plan",
    label: "Plan",
    description: "Generate a spec and drive the planning process",
    behavior: { kind: "chat_with_action", action: "generate_specs" },
  },
  image: {
    mode: "image",
    label: "Image",
    description: "Generate an image from a prompt",
    behavior: { kind: "generate_image", commandId: "generate_image" },
  },
  "3d": {
    mode: "3d",
    label: "3D",
    description: "Generate a 3D model",
    behavior: { kind: "generate_3d", commandId: "generate_3d" },
  },
  video: {
    mode: "video",
    label: "Video",
    description: "Generate a video from a prompt",
    behavior: { kind: "generate_video", commandId: "generate_video" },
  },
};

const AGENT_MODE_SET: ReadonlySet<AgentMode> = new Set(AGENT_MODE_ORDER);

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && AGENT_MODE_SET.has(value as AgentMode);
}

/**
 * Maps a mode to the `GenerationMode` value sent on the wire. Replaces
 * the previous "undefined means chat" pattern with an explicit "chat"
 * value so the wire shape is never ambiguous.
 */
export function generationModeForAgentMode(mode: AgentMode): GenerationMode {
  switch (mode) {
    case "code":
    case "plan":
      return "chat";
    case "image":
      return "image";
    case "3d":
      return "3d";
    case "video":
      return "video";
  }
}

const DEFAULT_AGENT_MODE_STORAGE_KEY = "aura-selected-mode:default";

export function loadPersistedAgentMode(_agentId?: string): AgentMode {
  try {
    const fallback = localStorage.getItem(DEFAULT_AGENT_MODE_STORAGE_KEY);
    if (isAgentMode(fallback)) return fallback;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_AGENT_MODE;
}

export function persistAgentMode(mode: AgentMode, _agentId?: string): void {
  try {
    localStorage.setItem(DEFAULT_AGENT_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage may be unavailable
  }
}
// smoke test verification
