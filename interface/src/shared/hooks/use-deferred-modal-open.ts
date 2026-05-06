import { useEffect, useRef, useState } from "react";

/* eslint-disable react-hooks/set-state-in-effect -- coordination hook: the effect drives open/preparing in response to async prepare() and timeout, not derived state */
/**
 * Defer opening a modal until its dependent data is ready, so the modal
 * renders once at its final size instead of janking when a button label
 * widens or a section appears post-mount.
 *
 * Pattern (caller side):
 *
 * ```tsx
 * const [requestedOpen, setRequestedOpen] = useState(false);
 * const { isOpen, isPreparing } = useDeferredModalOpen({
 *   requestedOpen,
 *   prepare: () => store.refreshSomething(),
 * });
 * return (
 *   <>
 *     <Button onClick={() => setRequestedOpen(true)} disabled={isPreparing}>
 *       Open
 *     </Button>
 *     <TheModal isOpen={isOpen} onClose={() => setRequestedOpen(false)} />
 *   </>
 * );
 * ```
 *
 * Behavior:
 * - When `requestedOpen` flips false → true, the hook calls `prepare()`
 *   (if provided) and waits for the returned promise. `isPreparing` is
 *   true during that window.
 * - When the prepare resolves (or rejects, or `prepare` is omitted /
 *   non-async), `isOpen` flips true on the *next* commit, so the modal
 *   never sees a transient state where the data is still loading.
 * - A `timeoutMs` failsafe (default 3000ms) opens the modal even if
 *   `prepare` never settles, so a broken fetch doesn't strand the user
 *   with a forever-pending trigger.
 * - When `requestedOpen` flips back to false the modal closes
 *   immediately and any still-in-flight prepare is orphaned (its
 *   resolution will not re-open the modal).
 */
export interface UseDeferredModalOpenArgs {
  requestedOpen: boolean;
  prepare?: () => Promise<unknown> | void;
  timeoutMs?: number;
}

export interface UseDeferredModalOpenResult {
  isOpen: boolean;
  isPreparing: boolean;
}

export function useDeferredModalOpen({
  requestedOpen,
  prepare,
  timeoutMs = 3000,
}: UseDeferredModalOpenArgs): UseDeferredModalOpenResult {
  const [isOpen, setIsOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);

  // Always call the latest `prepare` without re-running the open effect
  // on every render — consumers typically pass a fresh arrow each render.
  const prepareRef = useRef(prepare);
  useEffect(() => {
    prepareRef.current = prepare;
  }, [prepare]);

  // Each open cycle gets a monotonically increasing token. A late
  // resolution from a previous cycle (e.g. user closed and re-clicked
  // before the first prepare returned) checks this token before doing
  // anything, so stale promises can't reopen a closed modal.
  const cycleRef = useRef(0);

  useEffect(() => {
    if (!requestedOpen) {
      cycleRef.current += 1;
      setIsOpen(false);
      setIsPreparing(false);
      return;
    }

    const myCycle = ++cycleRef.current;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (cycleRef.current !== myCycle) return;
      setIsPreparing(false);
      setIsOpen(true);
    };

    setIsOpen(false);
    setIsPreparing(true);

    const fn = prepareRef.current;
    const result = typeof fn === "function" ? fn() : undefined;
    const isThenable =
      result != null &&
      typeof (result as { then?: unknown }).then === "function";

    if (!isThenable) {
      finish();
      return;
    }

    timeoutId = setTimeout(finish, timeoutMs);
    (result as Promise<unknown>).then(
      () => {
        if (timeoutId) clearTimeout(timeoutId);
        finish();
      },
      () => {
        if (timeoutId) clearTimeout(timeoutId);
        finish();
      },
    );

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [requestedOpen, timeoutMs]);

  return { isOpen, isPreparing };
}
