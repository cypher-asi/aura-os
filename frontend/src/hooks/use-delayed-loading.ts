import { useState, useEffect } from "react";

/**
 * Delays displaying a loading indicator so it doesn't flash when data arrives
 * almost immediately (e.g. fetching chat history for a brand-new agent).
 *
 * Returns `true` only after `isLoading` has been `true` for at least
 * `delayMs` continuously. If loading finishes before the timer fires the
 * indicator is never shown.
 *
 * Pass `delayMs = 0` to show the indicator immediately (opt-out).
 */
export function useDelayedLoading(
  isLoading: boolean,
  delayMs = 150,
): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }
    if (delayMs <= 0) {
      setShowLoading(true);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), delayMs);
    return () => clearTimeout(timer);
  }, [isLoading, delayMs]);

  if (delayMs <= 0 && isLoading) return true;

  return showLoading;
}
