/**
 * Bridge between AURA's chat stream and the Anam avatar.
 *
 * Observes the stream store's `streamingText` for a given `streamKey`
 * and forwards new text to the avatar's talk stream. Each assistant
 * turn creates a new `TurnStream`; when streaming stops the turn
 * is finalized so the avatar completes its speech.
 *
 * This approach avoids modifying the core stream handler — it's a
 * pure observer that reads from the existing Zustand store.
 */

import { useEffect, useRef } from "react";
import { useStreamStore } from "../stream/store";
import type { AnamAvatarHandle, TurnStream } from "./use-anam-avatar";

export function useAnamStreamBridge(
  streamKey: string,
  avatar: AnamAvatarHandle | null,
): void {
  const turnRef = useRef<TurnStream | null>(null);
  const lastLengthRef = useRef(0);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (
      !avatar ||
      (avatar.status !== "streaming" && avatar.status !== "ready")
    ) {
      return;
    }

    const unsubscribe = useStreamStore.subscribe((state) => {
      const entry = state.entries[streamKey];
      if (!entry) return;

      const { isStreaming } = entry;
      const text = entry.streamingText ?? "";

      if (isStreaming && !wasStreamingRef.current) {
        wasStreamingRef.current = true;
        lastLengthRef.current = 0;
        turnRef.current = avatar.beginTurn();
      }

      if (isStreaming && text.length > lastLengthRef.current) {
        const chunk = text.slice(lastLengthRef.current);
        lastLengthRef.current = text.length;
        if (turnRef.current?.isActive()) {
          void turnRef.current.sendChunk(chunk, false);
        }
      }

      if (!isStreaming && wasStreamingRef.current) {
        wasStreamingRef.current = false;
        if (turnRef.current?.isActive()) {
          void turnRef.current.end();
        }
        turnRef.current = null;
        lastLengthRef.current = 0;
      }
    });

    return unsubscribe;
  }, [streamKey, avatar]);
}
