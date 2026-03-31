import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { api } from "../../../api/client";
import { buildDisplayEvents } from "../../../utils/build-display-messages";
import type { Agent } from "../../../types";
import type { DisplaySessionEvent } from "../../../types/stream";

type FetchStatus = "idle" | "loading" | "ready" | "error";

type HistoryEntry = {
  events: DisplaySessionEvent[];
  status: FetchStatus;
  fetchedAt: number;
  error: string | null;
};

type AgentState = {
  agents: Agent[];
  agentsStatus: FetchStatus;
  agentsError: string | null;

  history: Record<string, HistoryEntry>;

  selectedAgentId: string | null;

  fetchAgents: (opts?: { force?: boolean }) => Promise<void>;
  patchAgent: (agent: Agent) => void;
  fetchHistory: (agentId: string, opts?: { force?: boolean }) => Promise<void>;
  prefetchHistory: (agentId: string) => void;
  invalidateHistory: (agentId: string) => void;
  setSelectedAgent: (agentId: string | null) => void;
};

const HISTORY_TTL_MS = 30_000;
const AGENTS_TTL_MS = 30_000;

export const useAgentStore = create<AgentState>()(
  subscribeWithSelector((set, get) => {
    let agentsFetchPromise: Promise<void> | null = null;
    let agentsFetchedAt = 0;
    const historyFetchPromises = new Map<string, Promise<void>>();

    return {
      agents: [],
      agentsStatus: "idle",
      agentsError: null,
      history: {},
      selectedAgentId: null,

      fetchAgents: async (opts): Promise<void> => {
        const { agentsStatus } = get();

        if (agentsFetchPromise) return agentsFetchPromise;

        if (
          !opts?.force &&
          agentsStatus === "ready" &&
          Date.now() - agentsFetchedAt < AGENTS_TTL_MS
        ) {
          return;
        }

        if (agentsStatus === "idle") {
          set({ agentsStatus: "loading", agentsError: null });
        }

        agentsFetchPromise = api.agents
          .list()
          .then(async (agents) => {
            const hasSuperAgent = agents.some(
              (a) => a.tags?.includes("super_agent") || a.role === "super_agent",
            );
            if (!hasSuperAgent) {
              try {
                const { agent } = await api.superAgent.setup();
                agents.push(agent);
              } catch {
                // setup may fail if network is down; non-blocking
              }
            }
            const sorted = agents.sort((a, b) => {
              if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            agentsFetchedAt = Date.now();
            set({ agents: sorted, agentsStatus: "ready", agentsError: null });
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : "Failed to fetch agents";
            set({ agentsStatus: "error", agentsError: message });
          })
          .finally(() => {
            agentsFetchPromise = null;
          });

        return agentsFetchPromise;
      },

      patchAgent: (updated): void => {
        set((s) => ({
          agents: s.agents.map((a) =>
            a.agent_id === updated.agent_id ? updated : a,
          ),
        }));
      },

      fetchHistory: async (agentId, opts): Promise<void> => {
        const entry = get().history[agentId];
        const now = Date.now();

        if (
          !opts?.force &&
          entry?.status === "ready" &&
          now - entry.fetchedAt < HISTORY_TTL_MS
        ) {
          return;
        }

        const existing = historyFetchPromises.get(agentId);
        if (existing) return existing;

        if (!entry || entry.status !== "ready") {
          set((s) => ({
            history: {
              ...s.history,
              [agentId]: {
                events: entry?.events ?? [],
                status: "loading",
                fetchedAt: entry?.fetchedAt ?? 0,
                error: null,
              },
            },
          }));
        }

        const promise = api.agents
          .listEvents(agentId)
          .then((raw) => {
            const events = buildDisplayEvents(raw);
            set((s) => ({
              history: {
                ...s.history,
                [agentId]: {
                  events,
                  status: "ready",
                  fetchedAt: Date.now(),
                  error: null,
                },
              },
            }));
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : "Failed to fetch history";
            set((s) => ({
              history: {
                ...s.history,
                [agentId]: {
                  events: entry?.events ?? [],
                  status: "error",
                  fetchedAt: entry?.fetchedAt ?? 0,
                  error: message,
                },
              },
            }));
          })
          .finally(() => {
            historyFetchPromises.delete(agentId);
          });

        historyFetchPromises.set(agentId, promise);
        return promise;
      },

      prefetchHistory: (agentId): void => {
        get()
          .fetchHistory(agentId)
          .catch(() => {
            // fire-and-forget; error state is in the store
          });
      },

      invalidateHistory: (agentId): void => {
        set((s) => {
          const { [agentId]: _, ...rest } = s.history;
          return { history: rest };
        });
      },

      setSelectedAgent: (agentId): void => {
        set({ selectedAgentId: agentId });
      },
    };
  }),
);
