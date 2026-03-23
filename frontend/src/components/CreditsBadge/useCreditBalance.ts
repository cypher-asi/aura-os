import { useEffect, useState, useCallback, useRef } from "react";
import { useOrgStore } from "../../stores/org-store";
import { useEventStore } from "../../stores/event-store";
import { api } from "../../api/client";
import { EventType } from "../../types/aura-events";

export const CREDITS_UPDATED_EVENT = "credits-updated";

const POLL_INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 2_000;

interface CreditBalanceResult {
  credits: number | null;
  balanceFormatted: string | null;
}

export function useCreditBalance(): CreditBalanceResult {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const subscribe = useEventStore((s) => s.subscribe);
  const [credits, setCredits] = useState<number | null>(null);
  const [balanceFormatted, setBalanceFormatted] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const orgId = activeOrg?.org_id ?? null;

  const fetchBalance = useCallback(() => {
    if (!orgId) { setCredits(null); setBalanceFormatted(null); return; }
    api.orgs
      .getCreditBalance(orgId)
      .then((b) => {
        setCredits(b.balance_cents);
        setBalanceFormatted(b.balance_formatted);
      })
      .catch((err) => console.warn("Failed to fetch credit balance:", err));
  }, [orgId]);

  const debouncedFetch = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchBalance, DEBOUNCE_MS);
  }, [fetchBalance]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fetchBalance);
    return () => window.cancelAnimationFrame(frame);
  }, [fetchBalance]);

  useEffect(() => {
    const id = setInterval(fetchBalance, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchBalance]);

  useEffect(() => {
    const handler = () => fetchBalance();
    window.addEventListener(CREDITS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CREDITS_UPDATED_EVENT, handler);
  }, [fetchBalance]);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.TaskCompleted, debouncedFetch),
      subscribe(EventType.LoopFinished, debouncedFetch),
    ];
    return () => {
      unsubs.forEach((fn) => fn());
      clearTimeout(debounceRef.current);
    };
  }, [subscribe, debouncedFetch]);

  return { credits, balanceFormatted };
}
