import type { ChatAttachment } from "../../../../api/streams";
import type { GenerationMode } from "../../../../constants/models";
import {
  AGENT_MODE_DESCRIPTORS,
  type AgentMode,
  type HarnessAction,
} from "../../../../constants/modes";

/**
 * Fully-typed description of one send. Each variant carries ONLY the
 * fields that variant uses, so a `3d` send literally cannot reference
 * a `model`, and a `chat` send literally cannot reference an `action`.
 * This is the source of truth between the panel state and the legacy
 * `onSend` wire signature; `dispatch()` is the only place that adapts
 * back to the historic `(content, action, model, attachments,
 * commands, projectId, generationMode)` tuple.
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
      kind: "3d";
      content: string;
      attachments: ChatAttachment[];
      commands: string[];
    };

export interface ResolveSendInput {
  mode: AgentMode;
  content: string;
  selectedModel: string | null;
  attachments: ChatAttachment[];
  /** Slash-command IDs the user already attached as chips. */
  userCommandIds: string[];
}

/**
 * Translate the user's typed input + active mode into a
 * `ResolvedSend`. Modes that need a slash command on the wire (Image,
 * 3D) inject the matching command id and dedupe against any chip the
 * user already added, so picking Image mode + hitting Send produces
 * the exact same payload as typing `/image` and hitting Send.
 */
export function resolveSend({
  mode,
  content,
  selectedModel,
  attachments,
  userCommandIds,
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
    case "generate_3d":
      return {
        kind: "3d",
        content,
        attachments,
        commands: dedupe([behavior.commandId, ...userCommandIds]),
      };
  }
}

/**
 * Adapter from `ResolvedSend` to the legacy `onSend` callback shape.
 * The cast at the boundary is intentional and isolated: every other
 * file consumes `ResolvedSend` directly and gets full exhaustiveness.
 */
export type LegacyOnSend = (
  content: string,
  action: string | null,
  selectedModel: string | null,
  attachments: ChatAttachment[] | undefined,
  commands: string[] | undefined,
  projectId: string | undefined,
  generationMode: GenerationMode | undefined,
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
    case "3d":
      // 3D intentionally has no `model` field on the variant; pass
      // null on the wire so the request body omits it.
      onSend(send.content, null, null, attachments, commands, projectId, "3d");
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
    case "3d":
      return {
        content: send.content,
        action: null,
        model: null,
        attachments,
        commands,
        generationMode: "3d",
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
