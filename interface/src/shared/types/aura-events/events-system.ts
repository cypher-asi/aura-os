import type {
  SessionReady as HarnessSessionReady,
  AssistantMessageStart as HarnessAssistantMessageStart,
  AssistantMessageEnd as HarnessAssistantMessageEnd,
  TextDelta as HarnessTextDelta,
  ToolUseStart as HarnessToolUseStart,
} from "../harness-protocol";
import type { EventType } from "./event-types";

/**
 * Per-domain variants of `AuraEvent` covering build/test verification,
 * git, harness protocol, billing, process execution, generation
 * pipelines, and miscellaneous log/error/network events. Combined into
 * the full discriminated union in `event-types.ts`.
 */
export type SystemEventVariant =
  // ── Build verification ─────────────────────────────────────
  | { type: typeof EventType.BuildVerificationSkipped; content: {
      task_id: string;
      reason?: string;
      command?: string;
    } }
  | { type: typeof EventType.BuildVerificationStarted; content: {
      task_id: string;
      command?: string;
    } }
  | { type: typeof EventType.BuildVerificationPassed; content: {
      task_id: string;
      stdout?: string;
      duration_ms?: number;
    } }
  | { type: typeof EventType.BuildVerificationFailed; content: {
      task_id: string;
      stderr?: string;
      stdout?: string;
      duration_ms?: number;
      attempt?: number;
    } }
  | { type: typeof EventType.BuildFixAttempt; content: {
      task_id: string;
      attempt: number;
      stderr?: string;
    } }

  // ── Test verification ──────────────────────────────────────
  | { type: typeof EventType.TestVerificationStarted; content: {
      task_id: string;
      command?: string;
    } }
  | { type: typeof EventType.TestVerificationPassed; content: {
      task_id: string;
      tests?: { name: string; status: string; message?: string }[];
      summary?: string;
      duration_ms?: number;
    } }
  | { type: typeof EventType.TestVerificationFailed; content: {
      task_id: string;
      tests?: { name: string; status: string; message?: string }[];
      stderr?: string;
      summary?: string;
      duration_ms?: number;
      attempt?: number;
    } }
  | { type: typeof EventType.TestFixAttempt; content: {
      task_id: string;
      attempt: number;
      stderr?: string;
    } }

  // ── Git ────────────────────────────────────────────────────
  | { type: typeof EventType.GitCommitted; content: {
      task_id?: string;
      commit_sha: string;
      spec_id?: string;
    } }
  | { type: typeof EventType.GitCommitFailed; content: {
      task_id?: string;
      reason: string;
    } }
  | { type: typeof EventType.GitCommitRolledBack; content: {
      task_id?: string;
      commit_sha: string;
      reason: string;
    } }
  | { type: typeof EventType.GitPushed; content: {
      task_id?: string;
      spec_id?: string;
      summary?: string;
      repo?: string;
      branch?: string;
      commits?: { sha: string; message: string }[];
    } }
  | { type: typeof EventType.GitPushFailed; content: {
      task_id?: string;
      reason: string;
      commit_sha?: string;
      repo?: string;
      branch?: string;
      retry_safe?: boolean;
    } }
  | { type: typeof EventType.PushDeferred; content: {
      task_id?: string;
      reason: string;
      /** Failure classifier, e.g. `remote_rejected`, `transport_timeout`,
       *  `remote_storage_exhausted`. */
      class?: string;
      commit_sha?: string | null;
      /** Operator-facing remediation hint populated for classes the
       *  server knows how to talk about (currently only
       *  `remote_storage_exhausted`). */
      remediation?: string | null;
      /** Seconds until the orbit capacity guard will let retries
       *  resume. Populated when orbit is in cooldown after an
       *  ENOSPC trip; otherwise absent / null. */
      retry_after_secs?: number | null;
    } }
  | { type: typeof EventType.ProjectPushStuck; content: {
      task_id?: string;
      /** The streak threshold that was hit (default 3). */
      threshold: number;
      /** Last observed failure classifier. */
      class?: string;
      reason: string;
      /** Operator-facing remediation hint, mirrors the `push_deferred`
       *  payload so the banner can render actionable guidance. */
      remediation?: string | null;
      /** Seconds until the orbit capacity guard will let retries
       *  resume (for `remote_storage_exhausted` only). */
      retry_after_secs?: number | null;
    } }

  // ── Harness protocol (canonical types from aura-protocol) ────
  | { type: typeof EventType.SessionReady; content: HarnessSessionReady }
  | { type: typeof EventType.AssistantMessageStart; content: HarnessAssistantMessageStart }
  | { type: typeof EventType.AssistantMessageEnd; content: HarnessAssistantMessageEnd }
  | { type: typeof EventType.TextDelta; content: HarnessTextDelta }
  | { type: typeof EventType.ToolUseStart; content: HarnessToolUseStart }
  | { type: typeof EventType.AssistantTurnProgress; content: {
      message_id?: string;
      project_id?: string;
      session_id?: string;
      agent_instance_id?: string;
      agent_id?: string;
    } }

  // ── Billing ────────────────────────────────────────────────
  | { type: typeof EventType.CreditBalanceUpdated; content: {
      balance_cents: number;
      balance_formatted: string;
    } }

  // ── Process execution ────────────────────────────────────────
  | { type: typeof EventType.ProcessRunStarted; content: {
      process_id: string;
      run_id: string;
    } }
  | { type: typeof EventType.ProcessRunProgress; content: {
      process_id: string;
      run_id: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    } }
  | { type: typeof EventType.ProcessRunCompleted; content: {
      process_id: string;
      run_id: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    } }
  | { type: typeof EventType.ProcessRunFailed; content: {
      process_id: string;
      run_id: string;
      error?: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    } }
  | { type: typeof EventType.ProcessNodeExecuted; content: {
      process_id: string;
      run_id: string;
      node_id: string;
      node_type: string;
      status: string;
      input_tokens?: number;
      output_tokens?: number;
      model?: string;
    } }
  | { type: typeof EventType.ProcessNodeOutputDelta; content: {
      process_id: string;
      run_id: string;
      node_id: string;
      delta_type?: "text" | "thinking" | "tool_use_start" | "tool_result";
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      result?: string;
      is_error?: boolean;
    } }

  // ── Generation (image / 3D) ─────────────────────────────────
  | { type: typeof EventType.GenerationStart; content: {
      mode: "image" | "3d";
      ts?: string;
    } }
  | { type: typeof EventType.GenerationProgress; content: {
      percent: number;
      message?: string;
    } }
  | { type: typeof EventType.GenerationPartialImage; content: {
      data: string;
    } }
  | { type: typeof EventType.GenerationCompleted; content: {
      mode: "image" | "3d";
      imageUrl?: string;
      originalUrl?: string;
      artifactId?: string;
      glbUrl?: string;
      polyCount?: number;
      meta?: Record<string, unknown>;
    } }
  | { type: typeof EventType.GenerationError; content: {
      code?: string;
      message: string;
    } }

  // ── Other ──────────────────────────────────────────────────
  | { type: typeof EventType.LogLine; content: {
      message: string;
      task_id?: string;
    } }
  | { type: typeof EventType.NetworkEvent; content: {
      network_event_type: string;
      payload: Record<string, unknown>;
    } }
  | { type: typeof EventType.Error; content: {
      message: string;
      task_id?: string;
    } };
