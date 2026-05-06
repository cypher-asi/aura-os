import type { ChatAttachment } from "../../../../api/streams";
import type { GenerationMode } from "../../../../constants/models";
import {
  AGENT_MODE_DESCRIPTORS,
  type AgentMode,
  type HarnessAction,
} from "../../../../constants/modes";

/**
 * Fully-typed description of one send. Each variant carries ONLY the
 * fields that variant uses, so a `3d_model_step` send literally
 * cannot reference a `model`, and a `chat` send literally cannot
 * reference an `action`.
 *
 * 3D mode is a two-step pipeline: a `3d_image_step` runs an
 * AURA-styled image generation when the input bar has no source thumb
 * pinned; a `3d_model_step` runs the image-to-3D conversion against
 * the pinned image when one exists. The split is the source of truth
 * for `useChatStream` / `useAgentChatStream` to choose between
 * `generateImageStream` and
 * `generate3dStream`.
 */
export type ResolvedSend =
  | {
      kind: "chat";
      content: string;
      model: string | null;
      attachments: ChatAttachment[];
      commands: string[];
    }
  | {
      kind: "chat_action";
      content: string;
      model: string | null;
      attachments: ChatAttachment[];
      commands: string[];
      action: HarnessAction;
    }
  | {
      kind: "image";
      content: string;
      model: string | null;
      attachments: ChatAttachment[];
      commands: string[];
    }
  | {
      kind: "3d_image_step";
      content: string;
      attachments: ChatAttachment[];
      commands: string[];
    }
  | {
      kind: "3d_model_step";
      content: string;
      attachments: ChatAttachment[];
      commands: string[];
      /**
       * URL of the pinned source image. Sourced from the per-stream
       * `pinnedSourceImage` slice of `chat-ui-store` — never derived
       * from the chat history snapshot.
       */
      sourceImageUrl: string;
    };

export interface ResolveSendInput {
  mode: AgentMode;
  content: string;
  selectedModel: string | null;
  attachments: ChatAttachment[];
  /** Slash-command IDs the user already attached as chips. */
  userCommandIds: string[];
  /**
   * URL of the source image pinned in the input bar (for 3D mode), or
   * null when no thumb is pinned. Sourced from the chat-ui store's
   * per-stream `pinnedSourceImage` slice; only consumed by the 3D
   * branch to choose between the image step and the 3D model step.
   */
  pinnedSourceImageUrl?: string | null;
}

/**
 * Translate the user's typed input + active mode into a
 * `ResolvedSend`. Modes that need a slash command on the wire (Image,
 * 3D) inject the matching command id and dedupe against any chip the
 * user already added, so picking Image mode + hitting Send produces
 * the exact same payload as typing `/image` and hitting Send.
 *
 * 3D mode splits on the presence of a pinned source image: no thumb
 * means we run the image step (AURA-styled prompt), thumb means we
 * run the model step against the pinned URL.
 */
export function resolveSend({
  mode,
  content,
  selectedModel,
  attachments,
  userCommandIds,
  pinnedSourceImageUrl,
}: ResolveSendInput): ResolvedSend {
  const behavior = AGENT_MODE_DESCRIPTORS[mode].behavior;
  switch (behavior.kind) {
    case "chat":
      return {
        kind: "chat",
        content,
        model: selectedModel,
        attachments,
        commands: dedupe(userCommandIds),
      };
    case "chat_with_action":
      return {
        kind: "chat_action",
        content,
        model: selectedModel,
        attachments,
        commands: dedupe(userCommandIds),
        action: behavior.action,
      };
    case "generate_image":
      return {
        kind: "image",
        content,
        model: selectedModel,
        attachments,
        commands: dedupe([behavior.commandId, ...userCommandIds]),
      };
    case "generate_3d": {
      const commands = dedupe([behavior.commandId, ...userCommandIds]);
      // Manual attachments are intentionally dropped on the 3D wire
      // shape today — neither branch accepts an arbitrary file (the
      // proxy path is disabled and the model step uses the pinned
      // URL exclusively).
      const empty: ChatAttachment[] = [];
      if (pinnedSourceImageUrl) {
        return {
          kind: "3d_model_step",
          content,
          attachments: empty,
          commands,
          sourceImageUrl: pinnedSourceImageUrl,
        };
      }
      return {
        kind: "3d_image_step",
        content,
        attachments: empty,
        commands,
      };
    }
  }
}

/**
 * Adapter from `ResolvedSend` to the legacy `onSend` callback shape.
 * The cast at the boundary is intentional and isolated: every other
 * file consumes `ResolvedSend` directly and gets full exhaustiveness.
 *
 * `sourceImageUrl` is only meaningful for the `3d_model_step` variant;
 * downstream stream hooks ignore it for every other generation mode.
 */
export type LegacyOnSend = (
  content: string,
  action: string | null,
  selectedModel: string | null,
  attachments: ChatAttachment[] | undefined,
  commands: string[] | undefined,
  projectId: string | undefined,
  generationMode: GenerationMode | undefined,
  sourceImageUrl?: string,
) => void;

export function dispatch(
  send: ResolvedSend,
  onSend: LegacyOnSend,
  projectId: string | undefined,
): void {
  const attachments = send.attachments.length > 0 ? send.attachments : undefined;
  const commands = send.commands.length > 0 ? send.commands : undefined;
  switch (send.kind) {
    case "chat":
      onSend(send.content, null, send.model, attachments, commands, projectId, undefined);
      return;
    case "chat_action":
      onSend(
        send.content,
        send.action,
        send.model,
        attachments,
        commands,
        projectId,
        undefined,
      );
      return;
    case "image":
      onSend(
        send.content,
        null,
        send.model,
        attachments,
        commands,
        projectId,
        "image",
      );
      return;
    case "3d_image_step":
      // Image step of chat 3D mode: dispatched as `generationMode:
      // "3d"` so `useChatStream` / `useAgentChatStream` route through
      // the chat-3D branch (which sees the missing `sourceImageUrl`
      // and runs the AURA-styled `generateImageStream`).
      onSend(send.content, null, null, attachments, commands, projectId, "3d", undefined);
      return;
    case "3d_model_step":
      // Model step: forward the pinned URL so the stream layer calls
      // `generate3dStream` with `{ kind: "url", ... }`.
      onSend(
        send.content,
        null,
        null,
        attachments,
        commands,
        projectId,
        "3d",
        send.sourceImageUrl,
      );
      return;
  }
}

/**
 * Translate a `ResolvedSend` into the queue-record shape used by
 * `message-queue-store`. Mirrors `dispatch()` but stores the result
 * as data instead of invoking a callback.
 */
export interface QueuedSendRecord {
  content: string;
  action: string | null;
  model: string | null;
  attachments: ChatAttachment[] | undefined;
  commands: string[] | undefined;
  generationMode: GenerationMode | undefined;
  /**
   * Only set for the `3d_model_step` variant; carried so a queued 3D
   * model send can replay against the same source image even if the
   * pin state changes between enqueue and dequeue.
   */
  sourceImageUrl?: string;
}

export function toQueuedRecord(send: ResolvedSend): QueuedSendRecord {
  const attachments = send.attachments.length > 0 ? send.attachments : undefined;
  const commands = send.commands.length > 0 ? send.commands : undefined;
  switch (send.kind) {
    case "chat":
      return {
        content: send.content,
        action: null,
        model: send.model,
        attachments,
        commands,
        generationMode: undefined,
      };
    case "chat_action":
      return {
        content: send.content,
        action: send.action,
        model: send.model,
        attachments,
        commands,
        generationMode: undefined,
      };
    case "image":
      return {
        content: send.content,
        action: null,
        model: send.model,
        attachments,
        commands,
        generationMode: "image",
      };
    case "3d_image_step":
      return {
        content: send.content,
        action: null,
        model: null,
        attachments,
        commands,
        generationMode: "3d",
      };
    case "3d_model_step":
      return {
        content: send.content,
        action: null,
        model: null,
        attachments,
        commands,
        generationMode: "3d",
        sourceImageUrl: send.sourceImageUrl,
      };
  }
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
