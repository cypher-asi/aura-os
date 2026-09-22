import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AgentMentionTarget, ChatAttachment } from "../api/streams";
import type { GenerationMode } from "../constants/models";
import { getStoredSession } from "../shared/lib/auth-token";
import { getResolvedHostOrigin } from "../shared/lib/host-config";
import {
  BROWSER_DB_STORES,
  browserDbGet,
  browserDbSetDurable,
} from "../shared/lib/browser-db";

const QUEUE_KEY = "pending";
const MAX_QUEUED_MESSAGES = 50;
const QUEUE_TTL_MS = 24 * 60 * 60 * 1_000;

export interface QueuedMessage {
  id: string;
  content: string;
  action: string | null;
  model?: string | null;
  attachments?: ChatAttachment[];
  commands?: string[];
  generationMode?: GenerationMode;
  /** Restored follow-ups never execute until the user explicitly resumes. */
  heldAfterRestart?: boolean;
  /** Source image pinned when a queued 3D send was created. */
  sourceImageUrl?: string;
  /** Structured project-agent selections preserved across queueing. */
  agentMentions?: AgentMentionTarget[];
  /** The upstream turn appeared stuck when this follow-up was queued. */
  pendingDueToStuckStream?: boolean;
}

interface PersistedQueuedMessage extends QueuedMessage {
  ownerId: string;
  hostOrigin: string;
  streamKey: string;
  createdAt: number;
}

interface PersistedCommandIdentity {
  commandId: string;
  ownerId: string;
  hostOrigin: string;
}

interface MessageQueueState {
  queues: Record<string, QueuedMessage[]>;
  hydrated: boolean;
  /** In-memory primitives retained for public chat and focused store tests. */
  enqueue: (streamKey: string, msg: Omit<QueuedMessage, "id">) => void;
  dequeue: (streamKey: string) => QueuedMessage | undefined;
  remove: (streamKey: string, id: string) => void;
  editContent: (streamKey: string, id: string, content: string) => void;
  moveUp: (streamKey: string, id: string) => void;
  clear: (streamKey: string) => void;
}

const EMPTY: QueuedMessage[] = [];
let mutationTail: Promise<void> = Promise.resolve();
let hydratedScope: string | null = null;

function newQueueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `q-${crypto.randomUUID()}`;
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function currentScope(): { ownerId: string; hostOrigin: string; key: string } | null {
  const ownerId = getStoredSession()?.user_id;
  if (!ownerId) return null;
  const hostOrigin = getResolvedHostOrigin();
  return { ownerId, hostOrigin, key: `${ownerId}\u0000${hostOrigin}` };
}

function isLive(record: PersistedQueuedMessage, now = Date.now()): boolean {
  return now - record.createdAt < QUEUE_TTL_MS;
}

function publishCurrentScope(records: PersistedQueuedMessage[]): void {
  const scope = currentScope();
  if (!scope) {
    useMessageQueueStore.setState({ queues: {}, hydrated: true });
    return;
  }
  const queues: Record<string, QueuedMessage[]> = {};
  for (const record of records) {
    if (
      record.ownerId !== scope.ownerId ||
      record.hostOrigin !== scope.hostOrigin ||
      !isLive(record)
    ) {
      continue;
    }
    const {
      ownerId: _ownerId,
      hostOrigin: _hostOrigin,
      streamKey,
      createdAt: _createdAt,
      ...message
    } = record;
    queues[streamKey] = [...(queues[streamKey] ?? EMPTY), message];
  }
  useMessageQueueStore.setState({ queues, hydrated: true });
}

function mutatePersistedQueue<T>(
  mutation: (
    records: PersistedQueuedMessage[],
    scope: NonNullable<ReturnType<typeof currentScope>>,
  ) => { records: PersistedQueuedMessage[]; result: T },
): Promise<T> {
  const scope = currentScope();
  if (!scope) {
    return Promise.reject(new Error("No authenticated queue scope"));
  }
  let mutationResult!: T;
  const work = mutationTail.then(async () => {
    const stored =
      (await browserDbGet<PersistedQueuedMessage[]>(
        BROWSER_DB_STORES.chatFollowUpQueue,
        QUEUE_KEY,
      )) ?? [];
    const next = mutation(stored.filter(isLive), scope);
    mutationResult = next.result;
    const bounded = next.records.slice(-MAX_QUEUED_MESSAGES);
    await browserDbSetDurable(
      BROWSER_DB_STORES.chatFollowUpQueue,
      QUEUE_KEY,
      bounded,
    );
    publishCurrentScope(bounded);
  });
  mutationTail = work.catch(() => {});
  return work.then(() => mutationResult);
}

function appendInMemory(
  streamKey: string,
  message: Omit<QueuedMessage, "id">,
): QueuedMessage {
  const entry: QueuedMessage = { ...message, id: newQueueId() };
  useMessageQueueStore.setState((state) => ({
    queues: {
      ...state.queues,
      [streamKey]: [...(state.queues[streamKey] ?? EMPTY), entry],
    },
  }));
  return entry;
}

export class MessageQueueUnavailableError extends Error {
  override name = "MessageQueueUnavailableError";

  constructor() {
    super(
      "Couldn't safely save this follow-up on this device. Your draft is still here; free some storage and try again.",
    );
  }
}

/** Durably queue a follow-up before the composer is cleared. */
export async function enqueueQueuedMessage(
  streamKey: string,
  message: Omit<QueuedMessage, "id" | "heldAfterRestart">,
): Promise<QueuedMessage> {
  const scope = currentScope();
  if (!scope) return appendInMemory(streamKey, message);

  const entry: QueuedMessage = {
    ...message,
    id: newQueueId(),
    heldAfterRestart: false,
  };
  try {
    await mutatePersistedQueue((records) => ({
      records: [
        ...records,
        {
          ...entry,
          ownerId: scope.ownerId,
          hostOrigin: scope.hostOrigin,
          streamKey,
          createdAt: Date.now(),
        },
      ],
      result: entry,
    }));
    return entry;
  } catch {
    throw new MessageQueueUnavailableError();
  }
}

/** Remove the head only after its deletion is durable; held heads stay put. */
export async function takeNextQueuedMessage(
  streamKey: string,
): Promise<QueuedMessage | undefined> {
  const scope = currentScope();
  if (!scope) return useMessageQueueStore.getState().dequeue(streamKey);

  return mutatePersistedQueue((records) => {
    const index = records.findIndex(
      (record) =>
        record.ownerId === scope.ownerId &&
        record.hostOrigin === scope.hostOrigin &&
        record.streamKey === streamKey,
    );
    const record = index >= 0 ? records[index] : undefined;
    if (!record || record.heldAfterRestart) {
      return { records, result: undefined };
    }
    const next = [...records];
    next.splice(index, 1);
    const {
      ownerId: _ownerId,
      hostOrigin: _hostOrigin,
      streamKey: _streamKey,
      createdAt: _createdAt,
      ...message
    } = record;
    return { records: next, result: message };
  });
}

/**
 * Prepare the next follow-up for dispatch without opening a loss window.
 * Authenticated chat commands keep their queue record until the command
 * outbox has durably accepted the same id; public and media-generation sends
 * have no command-outbox handoff and are removed before dispatch instead.
 */
export async function prepareNextQueuedMessage(
  streamKey: string,
  selected?: QueuedMessage,
): Promise<QueuedMessage | undefined> {
  const item = selected ?? useMessageQueueStore.getState().queues[streamKey]?.[0];
  if (!item || item.heldAfterRestart) return undefined;
  if (currentScope() && !item.generationMode) return item;
  if (selected) {
    await removeQueuedMessage(streamKey, selected.id);
    return selected;
  }
  return takeNextQueuedMessage(streamKey);
}

export async function removeQueuedMessage(
  streamKey: string,
  id: string,
): Promise<void> {
  const scope = currentScope();
  if (!scope) {
    useMessageQueueStore.getState().remove(streamKey, id);
    return;
  }
  await mutatePersistedQueue((records) => ({
    records: records.filter(
      (record) =>
        record.ownerId !== scope.ownerId ||
        record.hostOrigin !== scope.hostOrigin ||
        record.streamKey !== streamKey ||
        record.id !== id,
    ),
    result: undefined,
  }));
}

export async function clearQueuedMessages(streamKey: string): Promise<void> {
  const scope = currentScope();
  if (!scope) {
    useMessageQueueStore.getState().clear(streamKey);
    return;
  }
  await mutatePersistedQueue((records) => ({
    records: records.filter(
      (record) =>
        record.ownerId !== scope.ownerId ||
        record.hostOrigin !== scope.hostOrigin ||
        record.streamKey !== streamKey,
    ),
    result: undefined,
  }));
}

/** Make restored work eligible again only after an explicit user action. */
export async function resumeQueuedMessages(streamKey: string): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  await mutatePersistedQueue((records) => ({
    records: records.map((record) =>
      record.ownerId === scope.ownerId &&
      record.hostOrigin === scope.hostOrigin &&
      record.streamKey === streamKey
        ? { ...record, heldAfterRestart: false }
        : record,
    ),
    result: undefined,
  }));
}

/** Restore this environment's queue once and hold every recovered item. */
export async function hydrateMessageQueues(): Promise<void> {
  const scope = currentScope();
  if (!scope) {
    hydratedScope = null;
    publishCurrentScope([]);
    return;
  }
  if (hydratedScope === scope.key) return;
  try {
    const commands =
      (await browserDbGet<PersistedCommandIdentity[]>(
        BROWSER_DB_STORES.chatCommandOutbox,
        QUEUE_KEY,
      )) ?? [];
    const handedOffIds = new Set(
      commands
        .filter(
          (command) =>
            command.ownerId === scope.ownerId &&
            command.hostOrigin === scope.hostOrigin,
        )
        .map((command) => command.commandId),
    );
    await mutatePersistedQueue((records) => ({
      records: records
        .filter(
          (record) =>
            record.ownerId !== scope.ownerId ||
            record.hostOrigin !== scope.hostOrigin ||
            !handedOffIds.has(record.id),
        )
        .map((record) =>
          record.ownerId === scope.ownerId && record.hostOrigin === scope.hostOrigin
            ? { ...record, heldAfterRestart: true }
            : record,
        ),
      result: undefined,
    }));
    hydratedScope = scope.key;
  } catch {
    // Recovery must not block the authenticated shell. An empty projection is
    // safer than presenting an unverified record as executable.
    useMessageQueueStore.setState({ queues: {}, hydrated: true });
  }
}

export function _resetMessageQueuePersistenceForTests(): void {
  mutationTail = Promise.resolve();
  hydratedScope = null;
  useMessageQueueStore.setState({ queues: {}, hydrated: false });
}

export const useMessageQueueStore = create<MessageQueueState>()((set, get) => ({
  queues: {},
  hydrated: false,

  enqueue: (streamKey, msg) => {
    appendInMemory(streamKey, msg);
  },

  dequeue: (streamKey) => {
    const queue = get().queues[streamKey];
    if (!queue || queue.length === 0 || queue[0].heldAfterRestart) return undefined;
    const [first, ...rest] = queue;
    set((s) => ({ queues: { ...s.queues, [streamKey]: rest } }));
    return first;
  },

  remove: (streamKey, id) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev) return s;
      return { queues: { ...s.queues, [streamKey]: prev.filter((m) => m.id !== id) } };
    });
  },

  editContent: (streamKey, id, content) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev) return s;
      return {
        queues: {
          ...s.queues,
          [streamKey]: prev.map((m) => (m.id === id ? { ...m, content } : m)),
        },
      };
    });
  },

  moveUp: (streamKey, id) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev) return s;
      const idx = prev.findIndex((m) => m.id === id);
      if (idx <= 0) return s;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { queues: { ...s.queues, [streamKey]: next } };
    });
  },

  clear: (streamKey) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev || prev.length === 0) return s;
      return { queues: { ...s.queues, [streamKey]: EMPTY } };
    });
  },
}));

export function useMessageQueue(streamKey: string): QueuedMessage[] {
  return useMessageQueueStore(
    useShallow((s) => s.queues[streamKey] ?? EMPTY),
  );
}
