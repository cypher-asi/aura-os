import { useState, useRef, useCallback, useEffect } from "react";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";
import type { CreditBalance } from "../types";

export type CheckoutPollingStatus = "idle" | "polling" | "success" | "timeout";

const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

interface UseCheckoutPollingResult {
  status: CheckoutPollingStatus;
  settledBalance: CreditBalance | null;
  startPolling: (previousBalance: number) => void;
  reset: () => void;
}

export function useCheckoutPolling(orgId: string | undefined): UseCheckoutPollingResult {
  const subscribe = useEventStore((s) => s.subscribe);
  const [status, setStatus] = useState<CheckoutPollingStatus>("idle");
  const [settledBalance, setSettledBalance] = useState<CreditBalance | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unsubRef = useRef<(() => void) | undefined>(undefined);
  const prevBalanceRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (unsubRef.current) unsubRef.current();
    timeoutRef.current = undefined;
    unsubRef.current = undefined;
  }, []);

  const startPolling = useCallback(
    (previousBalance: number) => {
      if (!orgId) return;
      cleanup();
      prevBalanceRef.current = previousBalance;
      setStatus("polling");
      setSettledBalance(null);

      unsubRef.current = subscribe(EventType.CreditBalanceUpdated, (event) => {
        const { balance_cents, balance_formatted } = event.content;
        if (balance_cents != null && balance_cents > prevBalanceRef.current) {
          cleanup();
          const bal: CreditBalance = {
            balance_cents,
            balance_formatted: balance_formatted ?? `$${(balance_cents / 100).toFixed(2)}`,
            plan: "",
          };
          setSettledBalance(bal);
          setStatus("success");
        }
      });

      timeoutRef.current = setTimeout(() => {
        cleanup();
        setStatus("timeout");
      }, POLL_TIMEOUT_MS);
    },
    [orgId, cleanup, subscribe],
  );

  const reset = useCallback(() => {
    cleanup();
    setStatus("idle");
    setSettledBalance(null);
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { status, settledBalance, startPolling, reset };
}
