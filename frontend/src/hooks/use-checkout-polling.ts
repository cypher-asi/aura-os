import { useState, useRef, useCallback } from "react";
import { api } from "../api/client";

export type CheckoutPollingStatus = "idle" | "polling" | "success" | "timeout";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

export function useCheckoutPolling(orgId: string | undefined) {
  const [status, setStatus] = useState<CheckoutPollingStatus>("idle");
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timerRef.current = undefined;
    timeoutRef.current = undefined;
  }, []);

  const startPolling = useCallback(
    (previousBalance: number) => {
      if (!orgId) return;
      stopPolling();
      setStatus("polling");

      const poll = async () => {
        try {
          const b = await api.orgs.getCreditBalance(orgId);
          setCurrentBalance(b.total_credits);
          if (b.total_credits > previousBalance) {
            stopPolling();
            setStatus("success");
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
    [orgId, stopPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setStatus("idle");
  }, [stopPolling]);

  return { status, currentBalance, startPolling, reset };
}
