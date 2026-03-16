import { useEffect, useState, useCallback, useRef } from "react";
import type { DailyCommitActivity } from "../types";
import { api } from "../api/client";

interface UseCommitActivityParams {
  userIds?: string[];
  agentIds?: string[];
  startDate?: Date;
  endDate?: Date;
}

interface UseCommitActivityResult {
  data: Record<string, number>;
  loading: boolean;
  error: Error | null;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toRecord(entries: DailyCommitActivity[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of entries) {
    map[e.date] = (map[e.date] ?? 0) + e.count;
  }
  return map;
}

export function useCommitActivity(params: UseCommitActivityParams): UseCommitActivityResult {
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const fetch = useCallback(() => {
    const { userIds, agentIds, startDate, endDate } = paramsRef.current;
    setLoading(true);
    setError(null);

    api.activity
      .getCommitHistory({
        user_ids: userIds,
        agent_ids: agentIds,
        start_date: startDate ? toISODate(startDate) : undefined,
        end_date: endDate ? toISODate(endDate) : undefined,
      })
      .then((entries) => {
        setData(toRecord(entries));
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const userKey = params.userIds?.join(",") ?? "";
  const agentKey = params.agentIds?.join(",") ?? "";
  const startKey = params.startDate?.getTime() ?? "";
  const endKey = params.endDate?.getTime() ?? "";

  useEffect(() => {
    fetch();
  }, [fetch, userKey, agentKey, startKey, endKey]);

  return { data, loading, error };
}
