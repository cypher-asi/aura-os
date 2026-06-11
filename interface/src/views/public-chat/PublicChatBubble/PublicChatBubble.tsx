import { useTranslation } from "react-i18next";
import type { PublicMessage } from "../../../stores/public-chat-store";
import { LLMOutput } from "../../../apps/chat/components/LLMOutput";
import styles from "./PublicChatBubble.module.css";

/**
 * Public-chat (logged-out) bubble. Replaces the previous plain-text
 * `<div>` rendering in `PublicChatView` / `MobilePublicChatView` so
 * the assistant turn flows through `LLMOutput` → `ActivityTimeline`,
 * matching every authenticated LLM surface in the app.
 *
 * Why `LLMOutput` directly instead of the standard `MessageBubble` /
 * `StreamingBubble`: the public chat is a logged-out marketing
 * surface. The full `MessageBubble` envelope (gallery integration,
 * cross-agent attribution badge, ReportBug button, agent-store
 * lookup) presumes an authenticated session and a sidekick stream
 * store, neither of which exist here. Pulling that infrastructure
 * into the public surface is significantly larger scope than the
 * "consistent Block chrome" goal of the audit (see
 * `plans/thinking_block_audit.md` section E, which explicitly lists
 * "or `LLMOutput` directly" as the smallest fix). Routing through
 * `LLMOutput` already gives us the standard `ActivityTimeline` →
 * markdown / code-highlighting / Block chrome.
 *
 * NOTE: the public-chat backend SSE protocol currently emits only
 * `text_delta` / `limit` / `error` frames. No `thinking_delta` and
 * no `tool_call_*` events flow into public chat today, so the Phase 1
 * synthetic Brain "Thinking..." Block injected by `ActivityTimeline`
 * never fires here (its `hasAnyTool` gate is always `false`).
 * Surfacing real thinking blocks in public chat is a separate
 * backend protocol change — see the protocol note in
 * `interface/src/stores/public-chat-store.ts`.
 */
interface PublicChatBubbleProps {
  message: PublicMessage;
  isStreaming: boolean;
}

function isUser(
  message: PublicMessage,
): message is Extract<PublicMessage, { role: "user" }> {
  return message.role === "user";
}

function isAssistantTextMode(
  message: PublicMessage,
): message is Extract<
  PublicMessage,
  { role: "assistant"; mode: "code" | "plan" }
> {
  return (
    message.role === "assistant" &&
    (message.mode === "code" || message.mode === "plan")
  );
}

export function PublicChatBubble({
  message,
  isStreaming,
}: PublicChatBubbleProps): React.ReactElement {
  const { t } = useTranslation("publicChat");
  const rowClass = isUser(message)
    ? `${styles.messageRow} ${styles.messageRowUser}`
    : `${styles.messageRow} ${styles.messageRowAssistant}`;

  if (isUser(message)) {
    return (
      <div className={rowClass}>
        <div className={styles.messageBubble}>{message.content}</div>
      </div>
    );
  }

  if (isAssistantTextMode(message)) {
    return (
      <div className={rowClass}>
        <div className={styles.messageBubble}>
          <LLMOutput
            content={message.content}
            isStreaming={isStreaming}
            className={styles.assistantOutput}
          />
        </div>
      </div>
    );
  }

  // Media variants (image / video / model3d) — public-chat surfaces
  // historically rendered a placeholder string for these because the
  // wire shape carries `url` + `prompt` rather than a structured
  // content block. Preserving the placeholder keeps the visual
  // contract; surfacing media via the standard `MessageBubble`
  // image/video/3D strips would require additional store wiring and
  // is out of scope for this change.
  return (
    <div className={rowClass}>
      <div className={styles.messageBubble}>
        {t("bubble.mediaGeneratedFrom", {
          defaultValue: `${message.mode} generated from: ${message.prompt}`,
          mode: message.mode,
          prompt: message.prompt,
        })}
      </div>
    </div>
  );
}
