import { useState, useRef, useCallback } from "react";
import { api } from "../api/client";
import type { CreditBalance } from "../types";

export type CheckoutPollingStatus = "idle" | "polling" | "success" | "timeout";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const STATUS_SETTLE_TIMEOUT_MS = 15_000;

export function useCheckoutPolling(orgId: string | undefined) {
  const [status, setStatus] = useState<CheckoutPollingStatus>("idle");
  const [settledBalance, setSettledBalance] = useState<CreditBalance | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (settleRef.current) clearTimeout(settleRef.current);
    timerRef.current = undefined;
    timeoutRef.current = undefined;
    settleRef.current = undefined;
  }, []);

  const finish = useCallback((balance: CreditBalance) => {
    stopPolling();
    setSettledBalance(balance);
    setStatus("success");
  }, [stopPolling]);

  const startPolling = useCallback(
    (previousBalance: number) => {
      if (!orgId) return;
      stopPolling();
      setStatus("polling");
      setSettledBalance(null);
      let balanceIncreased = false;

      const poll = async () => {
        try {
          const b = await api.orgs.getCreditBalance(orgId);
          if (b.total_credits > previousBalance) {
            const hasPending = b.purchases.some((p) => p.status === "pending");
            if (!hasPending) {
              finish(b);
              return;
            }
            if (!balanceIncreased) {
              balanceIncreased = true;
              settleRef.current = setTimeout(() => finish(b), STATUS_SETTLE_TIMEOUT_MS);
            }
          }
        } catch {
          // keep polling on transient errors
        }
      };

      timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
      poll();

      timeoutRef.current = setTimeout(() => {
        stopPolling();
        setStatus("timeout");
      }, POLL_TIMEOUT_MS);
    },
    [orgId, stopPolling, finish],
  );

  const reset = useCallback(() => {
    stopPolling();
    setStatus("idle");
    setSettledBalance(null);
  }, [stopPolling]);

  return { status, settledBalance, startPolling, reset };
}
