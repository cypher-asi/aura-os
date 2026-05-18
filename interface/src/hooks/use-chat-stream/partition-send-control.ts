/**
 * Thin back-compat shim around the shared per-partition auto-retry
 * state module at `interface/src/hooks/stream/partition-state.ts`.
 *
 * The project-chat send-control map used to live here standalone,
 * with the standalone-agent surface keeping its own parallel
 * `agentChatStreamReplayMap` inside `use-agent-chat-stream.ts`. Tier 3
 * item 9 of the session-keying review consolidated both maps under
 * the shared module so a single `migratePartitionAutoRetry` helper
 * handles both surfaces in lockstep — eliminating the missed-call-site
 * bug pattern where the standalone-agent surface had to hand-roll its
 * own rekey block. This file remains so the existing import paths
 * (used in `use-chat-stream.ts`, `ChatPanel.tsx`, and the
 * `parallel-chats` / `migration` vitest suites) keep working without
 * churn; new code should import from `../stream/partition-state`
 * directly.
 */
export {
  type LastSendArgs,
  type PartitionSendControl,
  getPartitionSendControl,
  migratePartitionSendControl,
  _peekPartitionSendControl,
  _resetAllPartitionSendControl,
} from "../stream/partition-state";
