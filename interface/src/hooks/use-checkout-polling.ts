import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../shared/types/aura-events";
import type { CreditBalance } from "../shared/types";

export type CheckoutPollingStatus = "idle" | "polling" | "success" | "timeout";

const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const BALANCE_POLL_INTERVAL_MS = 2_000;

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const unsubRef = useRef<(() => void) | undefined>(undefined);
  const prevBalanceRef = useRef<number>(0);
  const runIdRef = useRef(0);
  const balanceRequestInFlightRef = useRef(false);

  const cleanup = useCallback((invalidate = false) => {
    if (invalidate) runIdRef.current += 1;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (unsubRef.current) unsubRef.current();
    timeoutRef.current = undefined;
    intervalRef.current = undefined;
    unsubRef.current = undefined;
    balanceRequestInFlightRef.current = false;
  }, []);

  const startPolling = useCallback(
    (previousBalance: number) => {
      if (!orgId) return;
      cleanup(true);
      const runId = runIdRef.current;
      prevBalanceRef.current = previousBalance;
      setStatus("polling");
      setSettledBalance(null);

      const settleWithBalance = (balance: CreditBalance) => {
        if (runId !== runIdRef.current) return;
        cleanup(true);
        setSettledBalance(balance);
        setStatus("success");
      };

      const maybeSettle = (balance_cents: number | null | undefined, balance_formatted?: string | null) => {
        if (runId !== runIdRef.current || balance_cents == null || balance_cents <= prevBalanceRef.current) {
          return false;
        }
        settleWithBalance({
          balance_cents,
          balance_formatted: balance_formatted ?? `$${(balance_cents / 100).toFixed(2)}`,
          plan: "",
        });
        return true;
      };

      unsubRef.current = subscribe(EventType.CreditBalanceUpdated, (event) => {
        const { balance_cents, balance_formatted } = event.content;
        maybeSettle(balance_cents, balance_formatted);
      });

      const checkBalance = async () => {
        if (runId !== runIdRef.current || balanceRequestInFlightRef.current) return;
        balanceRequestInFlightRef.current = true;
        try {
          const balance = await api.orgs.getCreditBalance(orgId);
          if (runId !== runIdRef.current) return;
          maybeSettle(balance.balance_cents, balance.balance_formatted);
        } catch {
          // Ignore transient billing fetch failures and keep waiting for the
          // next balance check or real-time event.
        } finally {
          if (runId === runIdRef.current) balanceRequestInFlightRef.current = false;
        }
      };

      intervalRef.current = setInterval(() => {
        void checkBalance();
      }, BALANCE_POLL_INTERVAL_MS);

      timeoutRef.current = setTimeout(() => {
        if (runId !== runIdRef.current) return;
        cleanup(true);
        setStatus("timeout");
      }, POLL_TIMEOUT_MS);
    },
    [orgId, cleanup, subscribe],
  );

  const reset = useCallback(() => {
    cleanup(true);
    setStatus("idle");
    setSettledBalance(null);
  }, [cleanup]);

  useEffect(() => () => cleanup(true), [cleanup]);

  return { status, settledBalance, startPolling, reset };
}
