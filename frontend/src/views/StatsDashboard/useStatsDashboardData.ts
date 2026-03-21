import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { useOrgStore } from "../../stores/org-store";

export type Period = "day" | "week" | "month" | "all";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
];

export interface UsageData {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

interface StatsDashboardData {
  period: Period;
  setPeriod: (p: Period) => void;
  personal: UsageData | null;
  org: UsageData | null;
  loading: boolean;
}

export function useStatsDashboardData(): StatsDashboardData {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const [period, setPeriod] = useState<Period>("month");
  const [personal, setPersonal] = useState<UsageData | null>(null);
  const [org, setOrg] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(() => {
    setLoading(true);
    const promises: Promise<void>[] = [
      api.usage.personal(period).then(setPersonal).catch(() => setPersonal(null)),
    ];
    if (activeOrg) {
      promises.push(
        api.usage.org(activeOrg.org_id, period).then(setOrg).catch(() => setOrg(null)),
      );
    }
    Promise.allSettled(promises).finally(() => setLoading(false));
  }, [period, activeOrg]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  return { period, setPeriod, personal, org, loading };
}
