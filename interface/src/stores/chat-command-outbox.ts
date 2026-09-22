import { create } from "zustand";
import type {
  AgentMentionTarget,
  ChatAttachment,
  MixtureRequest,
  MultiModelSlot,
  StreamEventHandler,
} from "../api/streams";
import { sendAgentEventStream, sendEventStream } from "../api/streams";
import { getChatCommandStatus } from "../shared/api/chat-commands";
import { ApiClientError } from "../shared/api/core";
import { getStoredSession } from "../shared/lib/auth-token";
import { getResolvedHostOrigin } from "../shared/lib/host-config";
import {
  BROWSER_DB_STORES,
  browserDbGet,
  browserDbSet,
  browserDbSetDurable,
} from "../shared/lib/browser-db";
import { useStreamStore } from "../hooks/stream/store";

const OUTBOX_KEY = "pending";
const MAX_OUTBOX_COMMANDS = 50;
const COMMAND_TTL_MS = 24 * 60 * 60 * 1_000;
const ACCEPTED_COMMAND_TTL_MS = 7 * COMMAND_TTL_MS;
const MAX_REPLAY_ATTEMPTS = 8;
const ACCEPTED_CHECK_DELAY_MS = 15_000;

type CouncilRequest = {
  models: MultiModelSlot[];
  mechanism?: string;
};

interface ChatCommandBase {
  commandId: string;
  ownerId: string;
  hostOrigin: string;
  content: string;
  action: string | null;
  model?: string | null;
  attachments?: ChatAttachment[];
  commands?: string[];
  sessionId?: string | null;
  council?: CouncilRequest;
  mixture?: MixtureRequest;
  /** Diagnostic only. Replays intentionally never repeat `new_session=true`. */
  originallyStartedNewSession: boolean;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  /** Saved by Aura, but not yet verified against a durable terminal marker. */
  accepted?: boolean;
  executionStatus?: "attached" | "unconfirmed" | "failed";
}

export interface ProjectChatCommand extends ChatCommandBase {
  surface: "project";
  projectId: string;
  agentInstanceId: string;
  agentMentions?: AgentMentionTarget[];
  safeWorkspace?: boolean;
}

export interface AgentChatCommand extends ChatCommandBase {
  surface: "agent";
  agentId: string;
  projectId?: string;
}

export type PendingChatCommand = ProjectChatCommand | AgentChatCommand;

interface ChatCommandOutboxProjection {
  /** Current authenticated user's commands for the resolved environment. */
  commands: PendingChatCommand[];
  hydrated: boolean;
}

export const useChatCommandOutboxStore = create<ChatCommandOutboxProjection>(() => ({
  commands: [],
  hydrated: false,
}));

type WithoutOutboxMetadata<T> = T extends PendingChatCommand
  ? Omit<
      T,
      "ownerId" | "hostOrigin" | "createdAt" | "attempts" | "nextAttemptAt" |
      "accepted" | "executionStatus"
    >
  : never;

export type NewChatCommand = WithoutOutboxMetadata<PendingChatCommand>;

let mutationTail: Promise<void> = Promise.resolve();
let drainPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let bootstrapInstalled = false;

export class ChatCommandOutboxUnavailableError extends Error {
  override name = "ChatCommandOutboxUnavailableError";

  constructor() {
    super(
      "Couldn't safely save this message on this device. Free some storage and try again.",
    );
  }
}

function currentOwnerId(): string | null {
  return getStoredSession()?.user_id ?? null;
}

function publishCurrentScope(commands: PendingChatCommand[]): void {
  const ownerId = currentOwnerId();
  const hostOrigin = getResolvedHostOrigin();
  const now = Date.now();
  useChatCommandOutboxStore.setState({
    commands: ownerId
      ? commands.filter(
          (command) =>
            command.ownerId === ownerId &&
            command.hostOrigin === hostOrigin &&
            now - command.createdAt <
              (command.accepted ? ACCEPTED_COMMAND_TTL_MS : COMMAND_TTL_MS),
        )
      : [],
    hydrated: true,
  });
}

function mutateOutbox(
  mutation: (commands: PendingChatCommand[]) => PendingChatCommand[],
  requireDurableCommit = false,
): Promise<void> {
  const work = mutationTail.then(async () => {
    const stored =
      (await browserDbGet<PendingChatCommand[]>(
        BROWSER_DB_STORES.chatCommandOutbox,
        OUTBOX_KEY,
      )) ?? [];
    const next = mutation(stored);
    if (requireDurableCommit) {
      await browserDbSetDurable(
        BROWSER_DB_STORES.chatCommandOutbox,
        OUTBOX_KEY,
        next,
      );
    } else {
      // Once a command has been durably enqueued, later bookkeeping is
      // best-effort. If a removal/backoff write fails, replaying the same
      // command id is safe because the server's acceptance receipt is
      // idempotent; blocking the UI on cache cleanup would be worse.
      await browserDbSet(
        BROWSER_DB_STORES.chatCommandOutbox,
        OUTBOX_KEY,
        next,
      );
    }
    publishCurrentScope(next);
  });
  mutationTail = work.catch(() => {});
  return work;
}

export async function enqueueChatCommand(command: NewChatCommand): Promise<void> {
  const ownerId = currentOwnerId();
  if (!ownerId) return;
  const hostOrigin = getResolvedHostOrigin();
  const now = Date.now();
  const pending = {
    ...command,
    ownerId,
    hostOrigin,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
  } as PendingChatCommand;
  try {
    await mutateOutbox(
      (commands) => {
        const live = commands.filter(
          (item) =>
            now - item.createdAt < COMMAND_TTL_MS &&
            !(
              item.ownerId === ownerId &&
              item.hostOrigin === hostOrigin &&
              item.commandId === command.commandId
            ),
        );
        return [...live, pending].slice(-MAX_OUTBOX_COMMANDS);
      },
      true,
    );
  } catch {
    throw new ChatCommandOutboxUnavailableError();
  }
}

export function removeChatCommand(commandId: string): Promise<void> {
  const ownerId = currentOwnerId();
  if (!ownerId) return Promise.resolve();
  const hostOrigin = getResolvedHostOrigin();
  const removal = mutateOutbox((commands) =>
    commands.filter(
      (command) =>
        command.ownerId !== ownerId ||
        command.hostOrigin !== hostOrigin ||
        command.commandId !== commandId,
    ),
  );
  setOptimisticDeliveryStatus(commandId, undefined);
  return removal;
}

/** Keep the accepted command until its agent turn has a durable outcome. */
export async function markChatCommandAccepted(
  commandId: string,
  executionStatus: "attached" | "unconfirmed" = "attached",
  sessionId?: string | null,
): Promise<void> {
  const ownerId = currentOwnerId();
  if (!ownerId) return;
  const hostOrigin = getResolvedHostOrigin();
  const nextAttemptAt = Date.now() + ACCEPTED_CHECK_DELAY_MS;
  await mutateOutbox((commands) => commands.map((command) =>
    command.ownerId === ownerId && command.hostOrigin === hostOrigin &&
    command.commandId === commandId
      ? { ...command, accepted: true, executionStatus, nextAttemptAt,
          sessionId: sessionId ?? command.sessionId }
      : command,
  ));
  setOptimisticDeliveryStatus(
    commandId,
    executionStatus === "unconfirmed" ? "unconfirmed" : undefined,
  );
  scheduleReplay(ACCEPTED_CHECK_DELAY_MS + 50);
}

/** Preserve a saved prompt's failed run for review instead of losing it. */
export async function markChatCommandExecutionFailed(
  commandId: string,
  sessionId?: string | null,
): Promise<void> {
  const ownerId = currentOwnerId();
  if (!ownerId) return;
  const hostOrigin = getResolvedHostOrigin();
  await mutateOutbox((commands) => commands.map((command) =>
    command.ownerId === ownerId && command.hostOrigin === hostOrigin &&
    command.commandId === commandId
      ? { ...command, accepted: true, executionStatus: "failed" as const,
          sessionId: sessionId ?? command.sessionId,
          nextAttemptAt: Number.MAX_SAFE_INTEGER }
      : command,
  ));
  setOptimisticDeliveryStatus(commandId, "executionFailed");
}

/** Stop future replay attempts for a command that has not been acknowledged. */
export async function cancelChatCommandReplay(commandId: string): Promise<boolean> {
  const ownerId = currentOwnerId();
  if (!ownerId) return false;
  const hostOrigin = getResolvedHostOrigin();
  let removed = false;
  await mutateOutbox((commands) =>
    commands.filter((command) => {
      const matches =
        command.ownerId === ownerId &&
        command.hostOrigin === hostOrigin &&
        command.commandId === commandId;
      removed ||= matches;
      return !matches;
    }),
  );
  if (removed) setOptimisticDeliveryStatus(commandId, "cancelled");
  return removed;
}

/** Make a deferred command eligible immediately and drain its scoped outbox. */
export async function retryChatCommandNow(commandId: string): Promise<boolean> {
  const ownerId = currentOwnerId();
  if (!ownerId) return false;
  const hostOrigin = getResolvedHostOrigin();
  let found = false;
  let accepted = false;
  await mutateOutbox((commands) =>
    commands.map((command) => {
      if (
        command.ownerId !== ownerId ||
        command.hostOrigin !== hostOrigin ||
        command.commandId !== commandId
      ) {
        return command;
      }
      found = true;
      accepted = Boolean(command.accepted);
      return { ...command, nextAttemptAt: Date.now() };
    }),
  );
  if (!found) return false;
  setOptimisticDeliveryStatus(commandId, accepted ? "unconfirmed" : "retrying");
  // A drain may already hold an older snapshot that skipped this command.
  // Running again after it settles guarantees the newly eligible row is seen.
  await drainChatCommandOutbox();
  await drainChatCommandOutbox();
  return true;
}

export function shouldReplayChatCommandError(error: unknown): boolean {
  if (error instanceof ChatCommandOutboxUnavailableError) return false;
  if (!(error instanceof ApiClientError)) return true;
  return (
    error.status === 408 ||
    error.status === 409 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

function retryDelayMs(attempts: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempts - 1), 60_000);
}

export async function recordChatCommandFailure(
  commandId: string,
  error: unknown,
): Promise<void> {
  const ownerId = currentOwnerId();
  if (!ownerId) return;
  const hostOrigin = getResolvedHostOrigin();
  const now = Date.now();
  let nextDelay = 1_000;
  let retainedForReplay = false;
  let acceptedForReplay = false;
  await mutateOutbox((commands) =>
    commands.flatMap((command) => {
      if (
        command.ownerId !== ownerId ||
        command.hostOrigin !== hostOrigin ||
        command.commandId !== commandId
      ) {
        return [command];
      }
      // A deterministic rejection (validation, permissions, credits, etc.)
      // must remain a visible failed bubble, not surprise the user later.
      if (
        (!command.accepted && !shouldReplayChatCommandError(error)) ||
        (!command.accepted && command.attempts >= MAX_REPLAY_ATTEMPTS)
      ) {
        return [];
      }
      const attempts = command.attempts + 1;
      acceptedForReplay = Boolean(command.accepted);
      nextDelay = command.accepted
        ? Math.max(ACCEPTED_CHECK_DELAY_MS, retryDelayMs(attempts))
        : retryDelayMs(attempts);
      retainedForReplay = true;
      return [{
        ...command,
        attempts,
        nextAttemptAt: now + nextDelay,
        ...(command.accepted ? { executionStatus: "unconfirmed" as const } : {}),
      }];
    }),
  );
  setOptimisticDeliveryStatus(
    commandId,
    retainedForReplay ? (acceptedForReplay ? "unconfirmed" : "retrying") : "failed",
  );
  if (retainedForReplay) scheduleReplay(nextDelay + 50);
}

function setOptimisticDeliveryStatus(
  commandId: string,
  status: "sending" | "retrying" | "unconfirmed" | "executionFailed" |
    "failed" | "cancelled" | undefined,
): void {
  useStreamStore.setState((state) => {
    let changed = false;
    const entries = Object.fromEntries(
      Object.entries(state.entries).map(([key, entry]) => {
        let entryChanged = false;
        const events = entry.events.map((event) => {
          if (event.clientId !== commandId) return event;
          changed = true;
          entryChanged = true;
          const updated = { ...event };
          if (status === undefined) delete updated.deliveryStatus;
          else updated.deliveryStatus = status;
          return updated;
        });
        return [key, entryChanged ? { ...entry, events } : entry];
      }),
    );
    return changed ? { entries } : state;
  });
}

async function replayCommand(command: PendingChatCommand): Promise<void> {
  if (command.accepted) {
    // Once the server has acknowledged persistence, polling is a read-only
    // status check. Never re-upload large attachments or open another turn.
    if (!command.sessionId) {
      await markChatCommandAccepted(command.commandId, "unconfirmed");
      return;
    }
    try {
      const target = command.surface === "project"
        ? { surface: "project" as const, projectId: command.projectId,
            agentInstanceId: command.agentInstanceId, sessionId: command.sessionId }
        : { surface: "agent" as const, agentId: command.agentId,
            sessionId: command.sessionId };
      const status = await getChatCommandStatus(target, command.commandId);
      if (status.executionStatus === "completed") {
        await removeChatCommand(command.commandId);
      } else if (status.executionStatus === "failed") {
        await markChatCommandExecutionFailed(command.commandId, status.sessionId);
      } else {
        await markChatCommandAccepted(
          command.commandId,
          status.executionStatus,
          status.sessionId,
        );
      }
    } catch (error) {
      await recordChatCommandFailure(command.commandId, error);
    }
    return;
  }
  setOptimisticDeliveryStatus(command.commandId, "sending");
  await new Promise<void>((resolve) => {
    let settled = false;
    const controller = new AbortController();
    const settle = (work: Promise<void>) => {
      if (settled) return;
      settled = true;
      controller.abort();
      void work.then(resolve, resolve);
    };
    const handler: StreamEventHandler = {
      onEvent: () => {},
      onAccepted: (receipt) => {
        if (receipt.commandId !== command.commandId) return;
        if (receipt.executionStatus === "attached" ||
            receipt.executionStatus === "unconfirmed") {
          settle(markChatCommandAccepted(
            command.commandId,
            receipt.executionStatus,
            receipt.sessionId,
          ));
        } else if (receipt.executionStatus === "failed") {
          settle(markChatCommandExecutionFailed(command.commandId, receipt.sessionId));
        } else {
          // Older servers have no execution-status header. Preserve their
          // previous receipt behavior rather than polling forever.
          settle(removeChatCommand(command.commandId));
        }
      },
      onError: (error) => {
        settle(recordChatCommandFailure(command.commandId, error));
      },
      onDone: () => {
        if (!settled) {
          settle(recordChatCommandFailure(
            command.commandId,
            new Error("Command replay ended before acknowledgement"),
          ));
        }
      },
    };

    const request = command.surface === "project"
      ? sendEventStream(
          command.projectId,
          command.agentInstanceId,
          command.content,
          command.action,
          command.model,
          command.attachments,
          handler,
          controller.signal,
          command.commands,
          false,
          command.sessionId,
          undefined,
          command.council,
          command.mixture,
          command.agentMentions,
          command.safeWorkspace,
          command.commandId,
          true,
          command.accepted === true,
        )
      : sendAgentEventStream(
          command.agentId,
          command.content,
          command.action,
          command.model,
          command.attachments,
          handler,
          controller.signal,
          command.commands,
          command.projectId,
          false,
          command.sessionId,
          undefined,
          command.council,
          command.mixture,
          command.commandId,
          true,
          command.accepted === true,
        );
    void request.catch((error) => {
      settle(recordChatCommandFailure(command.commandId, error));
    });
  });
}

export function drainChatCommandOutbox(): Promise<void> {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    await mutationTail;
    const commands =
      (await browserDbGet<PendingChatCommand[]>(
        BROWSER_DB_STORES.chatCommandOutbox,
        OUTBOX_KEY,
      )) ?? [];
    publishCurrentScope(commands);
    const ownerId = currentOwnerId();
    const hostOrigin = getResolvedHostOrigin();
    if (!ownerId || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const now = Date.now();
    let nextDueAt = Number.POSITIVE_INFINITY;
    for (const command of commands) {
      if (currentOwnerId() !== ownerId) break;
      if (command.ownerId !== ownerId || command.hostOrigin !== hostOrigin) continue;
      if (now - command.createdAt >=
        (command.accepted ? ACCEPTED_COMMAND_TTL_MS : COMMAND_TTL_MS)) {
        await removeChatCommand(command.commandId);
        continue;
      }
      if (command.executionStatus === "failed") continue;
      if (command.nextAttemptAt > Date.now()) {
        nextDueAt = Math.min(nextDueAt, command.nextAttemptAt);
        continue;
      }
      await replayCommand(command);
    }
    // A restored WebView can boot before the saved retry deadline. It must
    // still wake itself at that deadline; otherwise no future foreground or
    // network event means an accepted command never gets checked again.
    if (Number.isFinite(nextDueAt)) {
      scheduleReplay(Math.max(50, nextDueAt - Date.now() + 50));
    }
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

function scheduleReplay(delayMs = 1_000): void {
  if (retryTimer !== null || typeof window === "undefined") return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void drainChatCommandOutbox();
  }, delayMs);
}

/** Install one authenticated-shell replay loop for boot, online and resume. */
export function bootstrapChatCommandOutbox(): void {
  if (bootstrapInstalled || typeof window === "undefined") return;
  bootstrapInstalled = true;
  window.addEventListener("online", () => void drainChatCommandOutbox());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drainChatCommandOutbox();
  });
  void drainChatCommandOutbox();
}

export function _resetChatCommandOutboxForTests(): void {
  bootstrapInstalled = false;
  drainPromise = null;
  mutationTail = Promise.resolve();
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  useChatCommandOutboxStore.setState({ commands: [], hydrated: false });
}
