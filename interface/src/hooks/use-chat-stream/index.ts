export { useChatStream } from "./use-chat-stream";
export { buildStreamHandler } from "./build-stream-handler";
export type { DispatchDeps } from "./build-stream-handler";
export {
  pushPendingSpec,
  pushPendingTask,
  removePendingArtifact,
  promotePendingSpec,
  promotePendingTask,
  backfillToolCallInput,
} from "./optimistic-artifacts";

export type {
  DisplayContentBlock,
  DisplayImageBlock,
  DisplayContentBlockUnion,
  ArtifactRef,
  DisplaySessionEvent,
  ToolCallEntry,
} from "../../shared/types/stream";
