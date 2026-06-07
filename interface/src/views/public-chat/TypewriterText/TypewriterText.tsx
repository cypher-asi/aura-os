import { useEffect, useState, type ReactNode } from "react";
import styles from "./TypewriterText.module.css";

interface TypewriterTextProps {
  /** Final text to stream into the bubble. */
  readonly text: string;
  /**
   * Milliseconds between character reveals. Defaults to 28ms — about
   * 36 cps, which sits in the same ballpark as a real OpenAI/Anthropic
   * streaming response on a fast connection and is fast enough that
   * the longest message in `SCRIPT` (~60 chars) completes in well
   * under 2 seconds, leaving room to linger before the script
   * advances.
   */
  readonly speedMs?: number;
  /**
   * Opt-in looping mode. When a non-empty array is passed the
   * component ignores `text` and instead cycles forever through these
   * phrases: type one in, hold it, erase it, then advance to the next
   * (wrapping at the end). The single-`text` consumers (the `/agents`
   * product hero, the decorative `DMWindow` bubbles) leave this unset
   * and keep the original type-once-then-stop behaviour. The caret
   * never settles to hidden in loop mode since the stream is never
   * "complete".
   */
  readonly phrases?: readonly string[];
  /**
   * Loop-mode only. Milliseconds to hold a fully-typed phrase on
   * screen before the erase pass begins. Defaults to 1200ms.
   */
  readonly holdMs?: number;
  /**
   * Loop-mode only. Milliseconds between character deletions during
   * the erase pass. Defaults to 25ms — snappier than the type speed so
   * the rewind reads as a quick backspace rather than a second reveal.
   */
  readonly eraseMs?: number;
  /**
   * Whether to render the trailing block caret while the text streams.
   * Defaults to `true` (the chat-bubble / DM-window look). The marketing
   * hero headlines (`/agents`, `/code`) pass `false` so the copy types
   * in cleanly with no blinking square trailing it.
   */
  readonly showCaret?: boolean;
}

/**
 * Streams `text` one character at a time, mimicking the way LLM
 * responses arrive token-by-token in real chat UIs. While the stream
 * is still progressing a small block caret hangs off the trailing
 * edge of the visible prefix so the bubble reads as "actively being
 * written" rather than truncated; once the full text is on screen
 * the caret disappears.
 *
 * `setInterval` (rather than chained `setTimeout`s) drives the
 * reveal so a single test-time `vi.advanceTimersByTime(N)` flushes
 * the entire stream — chained timeouts only progress one character
 * per `act()` flush because React can't schedule the next timer
 * until the prior state update is committed, which would force every
 * test that touches a message bubble to loop one-tick-at-a-time.
 *
 * `prefers-reduced-motion: reduce` does NOT short-circuit the
 * stream. The only current consumer is the `MockAuraApp` hero (via
 * its DM windows), which is entirely decorative and whose
 * surrounding timeline is explicitly designed to play even under
 * reduced motion (see the mock app file comment); pinning the
 * message text to "appear instantly" for reduced-motion users made
 * the demo read as broken — the typing dots would vanish and the
 * full message would already be sitting in the bubble, with no
 * sense of "the agent just replied". A future non-decorative
 * consumer should add its own reduced-motion gate at the callsite
 * rather than relying on this one.
 */
export function TypewriterText({
  text,
  speedMs = 28,
  phrases,
  holdMs = 1200,
  eraseMs = 25,
  showCaret = true,
}: TypewriterTextProps): ReactNode {
  const isLoop = Boolean(phrases && phrases.length > 0);
  // In loop mode the visible string is driven entirely by the loop
  // state machine below; the single-`text` path keeps streaming a
  // prefix of the fixed `text` via the `shown` count.
  const [shown, setShown] = useState<number>(0);
  const [loopText, setLoopText] = useState<string>("");

  useEffect(() => {
    if (isLoop) {
      return;
    }
    if (text.length === 0) {
      setShown(0);
      return;
    }

    setShown(0);

    let i = 0;
    const handle = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) {
        clearInterval(handle);
      }
    }, speedMs);
    return () => clearInterval(handle);
  }, [isLoop, text, speedMs]);

  useEffect(() => {
    if (!isLoop || !phrases) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let phraseIndex = 0;
    let charCount = 0;
    let phase: "typing" | "holding" | "erasing" = "typing";

    const tick = (): void => {
      const current = phrases[phraseIndex] ?? "";

      if (phase === "typing") {
        charCount += 1;
        setLoopText(current.slice(0, charCount));
        if (charCount >= current.length) {
          phase = "holding";
          timer = setTimeout(tick, holdMs);
          return;
        }
        timer = setTimeout(tick, speedMs);
        return;
      }

      if (phase === "holding") {
        phase = "erasing";
        timer = setTimeout(tick, eraseMs);
        return;
      }

      // erasing
      charCount -= 1;
      setLoopText(current.slice(0, Math.max(charCount, 0)));
      if (charCount <= 0) {
        phase = "typing";
        phraseIndex = (phraseIndex + 1) % phrases.length;
        timer = setTimeout(tick, speedMs);
        return;
      }
      timer = setTimeout(tick, eraseMs);
    };

    timer = setTimeout(tick, speedMs);
    return () => clearTimeout(timer);
  }, [isLoop, phrases, speedMs, holdMs, eraseMs]);

  const visibleText = isLoop ? loopText : text.slice(0, shown);
  // Loop mode never "completes" — the caret keeps blinking through the
  // type/hold/erase cycle. Single-text mode hides the caret once the
  // fixed string is fully revealed.
  const isComplete = !isLoop && shown >= text.length;

  // The caret is intentionally kept mounted at completion (just
  // toggled to `visibility: hidden` via `caretHidden`). Unmounting
  // an empty `inline-block` caret with `vertical-align: text-bottom`
  // forces the surrounding line box to recompute its baseline
  // strut without the inline-block contribution, which subpixel-
  // rounds the inline text ~1px vertically — visible as a subtle
  // jump in the DM bubble the instant a message finishes streaming.
  // Keeping the box in the line preserves the metrics across the
  // transition. See also the parallel fix in `TerminalStream`.
  return (
    <span className={styles.typewriter}>
      {visibleText}
      {showCaret ? (
        <span
          className={`${styles.caret} ${isComplete ? styles.caretHidden : ""}`}
          data-state={isComplete ? "hidden" : "blinking"}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
