import { QueryClient } from "@tanstack/react-query";

const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_GC_TIME_MS = 5 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      gcTime: DEFAULT_GC_TIME_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryDefaults = {
  staleTimeMs: DEFAULT_STALE_TIME_MS,
  gcTimeMs: DEFAULT_GC_TIME_MS,
} as const;
