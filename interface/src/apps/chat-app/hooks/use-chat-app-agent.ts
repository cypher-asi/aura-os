import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { useAgentStore } from "../../agents/stores";
import { isSuperAgent } from "../../../shared/types/permissions";
import type { Agent } from "../../../shared/types";

type ChatAppAgentStatus = "loading" | "ready" | "error";

interface ChatAppAgentSlice {
  agent: Agent | null;
  status: ChatAppAgentStatus;
  error: string | null;
  retry: () => void;
}

interface UseChatAppAgentOptions {
  remoteOnly?: boolean;
}

interface CachedAgentState {
  agent: Agent | null;
  status: ChatAppAgentStatus;
  error: string | null;
  inflight: Promise<void> | null;
  inflightRemoteOnly: boolean | null;
}

const LAST_AGENT_ID_KEY = "aura-chat-app:last-agent-id";

function readLastAgentId(): string | undefined {
  try {
    return (
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_AGENT_ID_KEY) ?? undefined
        : undefined
    );
  } catch {
    return undefined;
  }
}

function writeLastAgentId(agentId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  } catch {
    // localStorage may be unavailable / quota-exceeded; the in-memory
    // cache is still authoritative for the current app session.
  }
}

/**
 * Seed `cache.agent` from already-resolved data so the chat panel can
 * render on the first paint instead of blocking on the
 * `superAgent.setup()` round-trip. Order of preference:
 *
 *   1. The persisted last-resolved id paired with a matching row in
 *      `useAgentStore.agents` — survives cold reload, wins in the
 *      "user has used Chat before, agents list is already warm" case.
 *   2. The first `isSuperAgent`-shaped row in `useAgentStore.agents` —
 *      catches the "no persisted id yet, but the agents fan-out
 *      already landed the CEO" case (typical when the user navigated
 *      to /chat from another app like Agents/Projects whose mounts
 *      already triggered `fetchAgents()`).
 *
 * Returns the seeded agent or `null` when no warm cache is available;
 * the caller still kicks off `setup()` to heal in the background.
 */
function canUseAgentInRuntime(agent: Agent | null | undefined, remoteOnly: boolean): agent is Agent {
  if (!agent) return false;
  return !remoteOnly || agent.machine_type === "remote";
}

function seedAgentFromWarmStores(remoteOnly = false): Agent | null {
  const agents = useAgentStore.getState().agents;
  if (agents.length === 0) return null;
  const lastId = readLastAgentId();
  if (lastId) {
    const fromLast = agents.find((a) => a.agent_id === lastId);
    if (canUseAgentInRuntime(fromLast, remoteOnly)) return fromLast;
  }
  return agents.find((a) => isSuperAgent(a) && canUseAgentInRuntime(a, remoteOnly)) ?? null;
}

const cache: CachedAgentState = (() => {
  const seeded = typeof window !== "undefined" ? seedAgentFromWarmStores() : null;
  return {
    agent: seeded,
    status: seeded ? "ready" : "loading",
    error: null,
    inflight: null,
    inflightRemoteOnly: null,
  };
})();
const subscribers = new Set<() => void>();
let setupRequestId = 0;

function notify(): void {
  for (const fn of subscribers) fn();
}

function ensureSetup(remoteOnly = false): Promise<void> {
  if (!canUseAgentInRuntime(cache.agent, remoteOnly) && cache.agent !== null) {
    cache.agent = null;
    cache.status = "loading";
    cache.error = null;
    notify();
  }

  if (cache.inflight && cache.inflightRemoteOnly === remoteOnly) return cache.inflight;

  // If the in-memory cache is empty, take one more pass at the warm
  // stores in case `fetchAgents()` resolved between module-load and
  // this call. Cheap: just a `find()` over a few rows.
  if (!cache.agent) {
    const seeded = seedAgentFromWarmStores(remoteOnly);
    if (seeded) {
      cache.agent = seeded;
      cache.status = "ready";
      cache.error = null;
      notify();
    }
  }

  const isHealing = cache.agent !== null;
  const requestId = ++setupRequestId;
  if (!isHealing) {
    cache.status = "loading";
    cache.error = null;
    notify();
  }
  cache.inflightRemoteOnly = remoteOnly;

  cache.inflight = api.superAgent
    .setup()
    .then(({ agent }) => {
      if (requestId !== setupRequestId) return;
      if (!canUseAgentInRuntime(agent, remoteOnly)) {
        throw new Error("Couldn't start web chat. Aura returned a desktop-only agent.");
      }
      writeLastAgentId(agent.agent_id);
      cache.agent = agent;
      cache.status = "ready";
      cache.error = null;
      // Mirror into the shared agent store so the sidekick (Profile,
      // Memory, Skills, Chats tabs) and any other surface that reads
      // `useAgents()` finds the chat agent immediately, even on first
      // visit before `fetchAgents()` has populated the list.
      const store = useAgentStore.getState();
      const present = store.agents.some((a) => a.agent_id === agent.agent_id);
      if (present) {
        store.patchAgent(agent);
      } else {
        useAgentStore.setState((s) => ({ agents: [...s.agents, agent] }));
      }
    })
    .catch((err: unknown) => {
      if (requestId !== setupRequestId) return;
      // Heal-in-the-background errors must not blank a working seed.
      // If we already have an agent (warm seed), keep showing it; the
      // user can still chat. Surface the error only when we have
      // nothing to show.
      if (!isHealing) {
        cache.agent = null;
        cache.status = "error";
        cache.error = err instanceof Error ? err.message : "Couldn't start chat";
      } else {
        // Stay `ready`; record the warning silently for diagnostics.
        console.warn("[chat-app] background superAgent.setup() heal failed:", err);
      }
    })
    .finally(() => {
      if (requestId === setupRequestId) {
        cache.inflight = null;
        cache.inflightRemoteOnly = null;
        notify();
      }
    });

  return cache.inflight;
}

/**
 * Resolves the chat agent the Chat app talks to. Calls
 * `api.superAgent.setup()` once per app session — the endpoint is
 * idempotent and creates the canonical CEO + Home binding when
 * missing — and returns the resulting agent regardless of whether it
 * still matches the strict `isSuperAgent()` (name+role) shape. That
 * matters because users can rename their CEO; the strict check would
 * leave `useSuperAgent()` returning `null` forever and the Chat app
 * stuck on "Starting chat…".
 *
 * For cold opens, the cache is pre-seeded from `useAgentStore.agents`
 * (a CEO match or the persisted last-resolved id) so the panel can
 * render on the first frame; `setup()` then runs as a background
 * heal/refresh and reconciles the cache when the server response
 * lands. This eliminates the serial "blank canvas → Starting chat… →
 * panel" sequence the route used to walk through on every navigation.
 */
export function useChatAppAgent(options: UseChatAppAgentOptions = {}): ChatAppAgentSlice {
  const [, setTick] = useState(0);
  const remoteOnly = options.remoteOnly === true;
  const visibleAgent = canUseAgentInRuntime(cache.agent, remoteOnly) ? cache.agent : null;
  const visibleStatus: ChatAppAgentStatus =
    visibleAgent !== null ? cache.status : cache.status === "error" ? "error" : "loading";

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    subscribers.add(fn);
    void ensureSetup(remoteOnly);
    return () => {
      subscribers.delete(fn);
    };
  }, [remoteOnly]);

  return {
    agent: visibleAgent,
    status: visibleStatus,
    error: cache.error,
    retry: () => {
      // Force a fresh attempt after an error.
      if (cache.status === "error") {
        cache.agent = null;
        cache.status = "loading";
        cache.error = null;
        notify();
        void ensureSetup(remoteOnly);
      }
    },
  };
}

/**
 * Test-only: wipe the module-scope cache so a fresh import-time seed
 * (or full `setup()` round-trip) runs in the next test. Production
 * code never touches this.
 */
export function __resetChatAppAgentCacheForTests(): void {
  cache.agent = null;
  cache.status = "loading";
  cache.error = null;
  cache.inflight = null;
  cache.inflightRemoteOnly = null;
  setupRequestId += 1;
  subscribers.clear();
}
