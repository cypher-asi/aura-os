import { useEffect, useState, useCallback } from "react";
import { useOrgStore } from "../../stores/org-store";
import { useEventStore } from "../../stores/event-store/index";
import { api } from "../../api/client";
import { EventType } from "../../types/aura-events";

export const CREDITS_UPDATED_EVENT = "credits-updated";

interface CreditBalanceResult {
  credits: number | null;
  balanceFormatted: string | null;
}

export function useCreditBalance(): CreditBalanceResult {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const subscribe = useEventStore((s) => s.subscribe);
  const [credits, setCredits] = useState<number | null>(null);
  const [balanceFormatted, setBalanceFormatted] = useState<string | null>(null);
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

  // Initial HTTP fetch on mount / org change
  useEffect(() => {
    const frame = window.requestAnimationFrame(fetchBalance);
    return () => window.cancelAnimationFrame(frame);
  }, [fetchBalance]);

  // Real-time balance updates from z-billing via WebSocket
  useEffect(() => {
    return subscribe(EventType.CreditBalanceUpdated, (event) => {
      const { balance_cents, balance_formatted } = event.content;
      if (balance_cents != null) setCredits(balance_cents);
      if (balance_formatted) setBalanceFormatted(balance_formatted);
    });
  }, [subscribe]);

  // Manual trigger (e.g. after purchase modal closes)
  useEffect(() => {
    const handler = () => fetchBalance();
    window.addEventListener(CREDITS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CREDITS_UPDATED_EVENT, handler);
  }, [fetchBalance]);

  return { credits, balanceFormatted };
}
