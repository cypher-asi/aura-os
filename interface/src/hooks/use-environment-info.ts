import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { EnvironmentInfo } from "../types";

let cachedInfo: EnvironmentInfo | null = null;

export function useEnvironmentInfo() {
  const [data, setData] = useState<EnvironmentInfo | null>(cachedInfo);
  const [loading, setLoading] = useState(cachedInfo === null);

  useEffect(() => {
    if (cachedInfo) return;

    let cancelled = false;
    api.environment
      .getEnvironmentInfo()
      .then((info) => {
        if (cancelled) return;
        cachedInfo = info;
        setData(info);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}
