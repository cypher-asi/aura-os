import { useEffect, useState, useCallback, useRef } from "react";

import { useOrg } from "../context/OrgContext";
import { useEventContext } from "../context/EventContext";
import { api } from "../api/client";
import styles from "./CreditsBadge.module.css";

export const CREDITS_UPDATED_EVENT = "credits-updated";

const POLL_INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 2_000;

function formatCredits(n: number): string {
  return n.toLocaleString();
}

interface Props {
  onClick?: () => void;
}

export function CreditsBadge({ onClick }: Props) {
  const { activeOrg } = useOrg();
  const { subscribe } = useEventContext();
  const [credits, setCredits] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const orgId = activeOrg?.org_id ?? null;

  const fetchBalance = useCallback(() => {
    if (!orgId) {
      setCredits(null);
      return;
    }
    api.orgs
      .getCreditBalance(orgId)
      .then((b) => setCredits(b.total_credits))
      .catch(() => {});
  }, [orgId]);

  const debouncedFetch = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchBalance, DEBOUNCE_MS);
  }, [fetchBalance]);

  // Fetch on mount / org change
  useEffect(() => {
    const frame = window.requestAnimationFrame(fetchBalance);
    return () => window.cancelAnimationFrame(frame);
  }, [fetchBalance]);

  // Periodic polling
  useEffect(() => {
    const id = setInterval(fetchBalance, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchBalance]);

  // Refresh when credits are purchased
  useEffect(() => {
    const handler = () => fetchBalance();
    window.addEventListener(CREDITS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CREDITS_UPDATED_EVENT, handler);
  }, [fetchBalance]);

  // Refresh when tokens are consumed by AI tasks
  useEffect(() => {
    const unsubs = [
      subscribe("task_completed", debouncedFetch),
      subscribe("loop_finished", debouncedFetch),
    ];
    return () => {
      unsubs.forEach((fn) => fn());
      clearTimeout(debounceRef.current);
    };
  }, [subscribe, debouncedFetch]);

  const displayCredits = credits !== null ? formatCredits(credits) : "---";
  return (
    <div className={styles.creditsBadge} onClick={onClick} role="button" tabIndex={0}>
      <span className={styles.label}>{displayCredits} Z</span>
    </div>
  );
}
