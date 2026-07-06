import { useMemo } from "react";
import { useStandaloneAgentChat } from "../../../hooks/use-standalone-agent-chat";
import type { ChatPanelProps } from "../../chat/components/ChatPanel";

/**
 * The Chat app's "default ChatGPT model". Picked from
 * `AURA_MANAGED_CHAT_MODELS` in `constants/models.ts`. Seeded into the
 * stream's chat-ui slot via `ChatPanel`'s `defaultModel` prop, so first
 * sends from a freshly opened Chat app land on this model unless the
 * underlying agent has a per-agent persisted choice.
 */
const CHAT_APP_DEFAULT_MODEL = "aura-gpt-5-4-mini";

/**
 * Chat-app wiring. Reuses `useStandaloneAgentChat` (the same hook the
 * Agents app's standalone chat uses) so session creation, history sync,
 * SessionReady URL mirroring, fresh-canvas / new-chat semantics, and
 * context-usage hydration all behave identically to the Agents app's
 * own chat surface.
 *
 * The only override is `defaultModel`: the Chat app intentionally
 * boots fresh threads on `aura-gpt-5-4-mini` regardless of what the
 * underlying super-agent (CEO) has stored as its default. The model
 * picker remains fully editable; user selections continue to persist
 * via the existing per-agent localStorage key in `constants/models.ts`.
 */
export function useChatAppChat(
  agentId: string | undefined,
  pinnedSessionId: string | null,
  opts: { freshCanvasPending?: boolean; freshCanvasKey?: string | null } = {},
): ChatPanelProps {
  const base = useStandaloneAgentChat(agentId, pinnedSessionId, opts);
  return useMemo<ChatPanelProps>(
    () => ({
      ...base,
      defaultModel: CHAT_APP_DEFAULT_MODEL,
      composerTone: "chat",
    }),
    [base],
  );
}
