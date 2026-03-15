import { useState, useEffect } from "react";

/**
 * Delays displaying an empty-state so it doesn't flash while data is still
 * arriving (e.g. via SSE events shortly after an API call resolves empty).
 *
 * Returns `true` only after the component has been both done loading AND empty
 * for at least `delayMs`. If data arrives during the grace period the timer
 * resets and empty state is never shown.
 *
 * Pass `delayMs = 0` to skip the delay entirely (e.g. when pre-fetched data
 * already confirmed the list is empty).
 */
export function useDelayedEmpty(
  isEmpty: boolean,
  loading: boolean,
  delayMs = 800,
): boolean {
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    if (loading || !isEmpty) {
      setShowEmpty(false);
      return;
    }
    if (delayMs <= 0) {
      setShowEmpty(true);
      return;
    }
    const timer = setTimeout(() => setShowEmpty(true), delayMs);
    return () => clearTimeout(timer);
  }, [isEmpty, loading, delayMs]);

  if (delayMs <= 0 && isEmpty && !loading) return true;

  return showEmpty;
}
