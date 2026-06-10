import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { ArrowUp } from "lucide-react";
import styles from "./InputBarShell.module.css";

export interface InputBarShellHandle {
  focus: () => void;
  blur: () => void;
  /**
   * Underlying textarea node, exposed so consumers can read selection
   * state (e.g. for inline slash-command detection) without owning the
   * ref themselves. May be null before mount.
   */
  getTextarea: () => HTMLTextAreaElement | null;
}

export interface InputBarShellProps {
  /** Current textarea value. */
  value: string;
  /** Called when the textarea value changes. */
  onValueChange: (value: string) => void;
  /** Called when the user submits via Enter (without Shift) or the send button. */
  onSubmit: () => void;
  /** Called when the user clicks the stop button while `isStreaming` is true. */
  onStop?: () => void;
  /** When true, the send button is replaced with a stop button. */
  isStreaming?: boolean;
  /**
   * Whether the send button is enabled. Defaults to `value.trim().length > 0`.
   * Consumers (e.g. chat) can pass `true` to allow attachments-only sends.
   */
  isSendEnabled?: boolean;

  /**
   * When false, the entire wrapper is hidden (visibility: hidden, opacity: 0).
   * Defaults to true.
   */
  isVisible?: boolean;
  /** Empty-thread state — lifts the bar to vertical center with pulse. */
  isCentered?: boolean;
  /**
   * Heading rendered directly above the input box, but only while
   * `isCentered` is true. Lets empty-thread surfaces show a hero prompt
   * (e.g. "What do you want to create?") grouped with the centered
   * input so the two read as one block and dock together on first send.
   */
  centeredHeading?: ReactNode;
  /** Adds the centered-pulse animation to the inner container. */
  isPulsing?: boolean;
  /** Highlights the container border for active drag-and-drop. */
  isDropZone?: boolean;
  /**
   * Opt out of the floating absolute-positioned wrapper. Use when the
   * input bar is rendered as part of a normal flex/grid layout instead
   * of overlaying scrollable content (e.g. inside the aura3d tab panel).
   */
  isStatic?: boolean;
  /**
   * Opt into the "pill" chat treatment: a fully-rounded single-line
   * container with a lighter gradient fill, 1px gradient border, and
   * dark drop shadow. When set, the `modeBar` slot is rendered ABOVE
   * the rounded container (detached) instead of inside it. Other
   * surfaces (aura3d / auravideo / automation) leave this off and keep
   * the default rounded-box chrome.
   */
  pill?: boolean;
  /**
   * Pill mode only: when true, the fully-rounded (999px) pill softens to
   * the normal rounded-rectangle corner radius. Set this when the container
   * is expanded by stacked chrome (slash menu, attachments, the record-demo
   * settings panel, etc.) so a tall box doesn't render as a giant oval —
   * mirrors the automatic softening already applied in the multi-line state.
   */
  expanded?: boolean;

  /** Textarea placeholder. */
  placeholder?: string;
  /** When true, the textarea is disabled. */
  disabled?: boolean;
  /** Extra HTML attributes forwarded to the textarea (e.g. data-attrs). */
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "onKeyDown" | "onPaste" | "ref" | "placeholder" | "disabled"
  > & {
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
  };
  /**
   * Custom keydown handler. Runs in addition to the shell's Enter-to-submit
   * behavior. If the handler calls `e.preventDefault()`, the shell will not
   * submit, allowing consumers (e.g. chat slash menu) to intercept keys.
   */
  onTextareaKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Paste handler forwarded to the textarea. */
  onTextareaPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;

  /** Drag handlers wired to the inner container (drop zone). */
  onContainerDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onContainerDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onContainerDrop?: (e: DragEvent<HTMLDivElement>) => void;

  /**
   * Slot rendered as the topmost section of the inner container,
   * above `containerTop`. Used by chat surfaces for the agent MODE
   * selector (Code / Plan / Image / 3D) so it reads as a clearly
   * distinct row above attachments, slash menus, and the textarea.
   */
  modeBar?: ReactNode;
  /** Slot rendered inside the container, above the input row. */
  containerTop?: ReactNode;
  /**
   * Slot rendered inside the container, BELOW the input row. Used for
   * chrome that should sit at the bottom of the rounded container
   * (e.g. the chat surface drops the model picker here when the
   * textarea has wrapped to multiple lines so the prompt can use the
   * full container width). The shell does not style this slot beyond
   * making it a flex child; consumers own padding and layout.
   */
  containerBottom?: ReactNode;
  /** Slot rendered inside the input row at the start (e.g. attach button). */
  inputRowStart?: ReactNode;
  /** Slot rendered inside the input row at the end, before send/stop. */
  inputRowEnd?: ReactNode;
  /** Slot rendered at the start of the info bar (e.g. agent env, orbit). */
  infoBarStart?: ReactNode;
  /** Slot rendered at the end of the info bar (e.g. project, model picker). */
  infoBarEnd?: ReactNode;

  /** Aria label for the send button. Defaults to "Send". */
  sendAriaLabel?: string;
  /** Aria label for the stop button. Defaults to "Stop". */
  stopAriaLabel?: string;
  /** Title for the stop button (tooltip). */
  stopTitle?: string;

  /**
   * Fired when the textarea transitions between single-line and
   * multi-line states (text wrapped to a second visual row, or
   * reduced back to one). Fires once on mount with the initial state
   * so consumers can use it to drive layout (e.g. moving the model
   * picker out of the inline `inputRowEnd` slot).
   */
  onMultiLineChange?: (isMultiLine: boolean) => void;

  /** Extra HTML attributes for the outer wrapper (e.g. data-attrs). */
  rootProps?: Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
  };
}

function InputBarShellInner(
  {
    value,
    onValueChange,
    onSubmit,
    onStop,
    isStreaming = false,
    isSendEnabled,
    isVisible = true,
    isCentered = false,
    centeredHeading,
    isPulsing = false,
    isDropZone = false,
    isStatic = false,
    pill = false,
    expanded = false,
    placeholder,
    disabled = false,
    textareaProps,
    onTextareaKeyDown,
    onTextareaPaste,
    onContainerDragOver,
    onContainerDragLeave,
    onContainerDrop,
    modeBar,
    containerTop,
    containerBottom,
    inputRowStart,
    inputRowEnd,
    infoBarStart,
    infoBarEnd,
    sendAriaLabel = "Send",
    stopAriaLabel = "Stop",
    stopTitle,
    onMultiLineChange,
    rootProps,
  }: InputBarShellProps,
  ref: Ref<InputBarShellHandle>,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const singleLineHeightRef = useRef<number | null>(null);
  const isMultiLineRef = useRef(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  // Counter that suppresses the next N `ResizeObserver`-driven multi-line
  // re-evaluations. Armed every time `autoResize` actually toggles
  // `isMultiLine`, because the resulting `data-multiline` CSS swap is
  // what changes the textarea's content width — that width change is
  // about to fire `ResizeObserver`, and if our anti-osc prediction was
  // off by a sub-pixel at the wrap boundary the new measurement would
  // reverse the toggle on the next frame and the picker would bounce
  // inline↔footer forever. Real layout-driven width changes (window
  // resize, sidebar collapse, panel resize) come through the `window`
  // `resize` handler or a subsequent `ResizeObserver` fire after the
  // lockout disarms, so they still get a full evaluation.
  const transitionLockoutRef = useRef(0);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    blur: () => textareaRef.current?.blur(),
    getTextarea: () => textareaRef.current,
  }));

  // Just keeps the inline `height` in sync with the textarea's current
  // `scrollHeight` (capped). Used by the `ResizeObserver` callback while
  // the transition lockout is active so the textarea still grows/shrinks
  // to fit the new layout, but the multi-line decision is preserved.
  const applyHeightOnly = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = Math.min(window.innerHeight * 0.7, 800);
    el.style.height = Math.min(el.scrollHeight, cap) + "px";
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Cap the inline height to match the CSS max-height so the textarea's
    // own scrollbar engages for long messages (and native caret-follow on
    // Arrow keys keeps working).
    const cap = Math.min(window.innerHeight * 0.7, 800);
    const naturalHeight = el.scrollHeight;
    el.style.height = Math.min(naturalHeight, cap) + "px";

    // Capture the single-line baseline lazily from computed styles so
    // the threshold tracks the current font-size / line-height (which
    // changes between desktop and mobile via the @media override on
    // `.textarea`). Falls back to 32px (the default control height).
    if (singleLineHeightRef.current == null) {
      const cs = getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight);
      const padTop = parseFloat(cs.paddingTop);
      const padBottom = parseFloat(cs.paddingBottom);
      if (Number.isFinite(lineHeight)) {
        singleLineHeightRef.current = lineHeight + padTop + padBottom;
      }
    }
    const baseline = singleLineHeightRef.current ?? 32;
    // 4px tolerance covers sub-pixel rounding on HiDPI screens where
    // scrollHeight can land at e.g. 32.5px for a single-line textarea.
    const naturalMulti = naturalHeight > baseline + 4;
    let multi = naturalMulti;

    // Anti-oscillation: when the picker drops into the footer row in
    // multi-line state, the shell releases the textarea's inline-picker
    // padding-right reserve (~220px → 32px), which makes the same text
    // fit on a single line at the new wider width. A naive measurement
    // would then flip multi-line back to false on the very next
    // keystroke, the picker would slide back inline, the padding would
    // return, and the text would re-wrap — a per-character oscillation
    // that destroys backspace UX. Re-measure with the inline padding
    // simulated to answer "would the prompt still wrap if we showed
    // the picker inline?", and only collapse to single-line when the
    // answer is no.
    if (isMultiLineRef.current && !naturalMulti) {
      const prevInlinePaddingRight = el.style.paddingRight;
      // Wrap the `min(...)` in `calc(...)` so JSDOM's CSSOM (which
      // rejects bare `min()` in inline-style assignments) accepts it
      // for the test harness; real browsers parse both forms
      // identically. The expression mirrors the
      // `.inputRowHasEnd .textarea` rule in InputBarShell.module.css.
      el.style.paddingRight = "calc(min(220px, 42%))";
      el.style.height = "auto";
      const narrowHeight = el.scrollHeight;
      el.style.paddingRight = prevInlinePaddingRight;
      el.style.height = Math.min(naturalHeight, cap) + "px";
      multi = narrowHeight > baseline + 4;
    }

    // Symmetric anti-oscillation for the single → multi direction. The
    // inline padding-right reserve makes a prompt at the wrap boundary
    // appear to need a second line at single-line layout (~220px reserve
    // shrinks the content area), but the act of switching to multi-line
    // releases that reserve and the same prompt now fits on one line —
    // sub-pixel rounding in the narrow re-measurement above (or in the
    // ResizeObserver-driven autoResize that runs after the layout swap)
    // can then flip the state back to single-line, and the cycle
    // repeats per frame. The centered empty-thread wrapper anchors with
    // `bottom: 50%; transform: translateY(50%)`, so the ~44px height
    // delta translates to a visible up-and-down jitter of the entire
    // bar. Mirror the multi → single check: only flip into multi-line
    // when the prompt still wraps at the wider multi-line padding-right
    // of 32px. If the wide layout fits on one line, stay single-line
    // — the textarea will still autogrow to show the wrapped second
    // line at the narrow width, but the picker, info bar, and wrapper
    // height stay stable.
    if (!isMultiLineRef.current && naturalMulti) {
      const prevInlinePaddingRight = el.style.paddingRight;
      el.style.paddingRight = "32px";
      el.style.height = "auto";
      const wideHeight = el.scrollHeight;
      el.style.paddingRight = prevInlinePaddingRight;
      el.style.height = Math.min(naturalHeight, cap) + "px";
      multi = wideHeight > baseline + 4;
    }

    if (isMultiLineRef.current !== multi) {
      // Arm the lockout BEFORE flipping the ref so the upcoming
      // `data-multiline` swap's `ResizeObserver` fire treats itself as
      // a self-induced reflow and skips re-evaluating the multi-line
      // decision.
      transitionLockoutRef.current = 1;
    }
    isMultiLineRef.current = multi;
    setIsMultiLine((prev) => (prev === multi ? prev : multi));
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  useEffect(() => {
    const onResize = () => {
      // Width changes can rewrap the textarea (long line that fit at
      // wide widths now wraps), so re-measure the multi-line state too.
      // Reset the baseline when the font-size media-query crosses the
      // 900px / 640px breakpoints so the threshold tracks the new
      // line-height.
      singleLineHeightRef.current = null;
      autoResize();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [autoResize]);

  // Watch for textarea width changes that aren't viewport-driven —
  // e.g. when `[data-multiline="true"]` swaps the textarea's
  // padding-right reserve, or when the inline `inputRowEnd` slot
  // appears/disappears, the textarea grows/shrinks horizontally and
  // its wrap state can change. Re-measure so the inline height
  // assignment and the multi-line flag stay coherent with the
  // current layout (and so the height we set in the previous pass
  // doesn't strand empty pixels at the bottom of a now-shorter
  // textarea).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    let frame: number | null = null;
    let needsHeightOnly = false;
    let needsFullResize = false;
    const scheduleResize = (heightOnly: boolean) => {
      if (heightOnly) {
        needsHeightOnly = true;
      } else {
        needsFullResize = true;
      }
      if (frame != null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const runFullResize = needsFullResize;
        needsFullResize = false;
        const runHeightOnly = needsHeightOnly;
        needsHeightOnly = false;
        if (runFullResize) {
          autoResize();
        } else if (runHeightOnly) {
          applyHeightOnly();
        }
      });
    };
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (Math.abs(width - lastWidth) > 0.5) {
          lastWidth = width;
          if (transitionLockoutRef.current > 0) {
            // This fire is the consequence of our own `data-multiline`
            // swap toggling the textarea's `padding-right`. Re-running
            // the full `autoResize` here is what causes the per-frame
            // picker bounce at the wrap boundary, because the new
            // measurement at the just-swapped layout can disagree with
            // the anti-osc prediction by a sub-pixel. Consume the
            // lockout and only update the inline height.
            transitionLockoutRef.current--;
            scheduleResize(true);
          } else {
            scheduleResize(false);
          }
        }
      }
    });
    ro.observe(el);
    return () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
      }
      ro.disconnect();
    };
  }, [autoResize, applyHeightOnly]);

  useEffect(() => {
    onMultiLineChange?.(isMultiLine);
  }, [isMultiLine, onMultiLineChange]);

  const sendEnabled = isSendEnabled ?? value.trim().length > 0;
  const canSubmit = sendEnabled && !disabled;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onTextareaKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  const wrapperClassName = [
    styles.inputWrapper,
    isVisible ? "" : styles.inputWrapperHidden,
    isCentered ? styles.inputWrapperCentered : "",
    isStatic ? styles.inputWrapperStatic : "",
  ]
    .filter(Boolean)
    .join(" ");

  const containerClassName = [
    styles.inputContainer,
    pill ? styles.inputContainerPill : "",
    isDropZone ? styles.dropZoneActive : "",
    isPulsing || isCentered ? styles.inputContainerPulse : "",
    isMultiLine ? styles.inputContainerMultiLine : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inputRowClassName = [
    styles.inputRow,
    inputRowEnd ? styles.inputRowHasEnd : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      {...rootProps}
      className={wrapperClassName}
      aria-hidden={isVisible ? undefined : true}
      data-visible={isVisible ? "true" : "false"}
      data-centered={isCentered ? "true" : "false"}
    >
      {isCentered && centeredHeading ? (
        <div className={styles.centeredHeading}>{centeredHeading}</div>
      ) : null}
      {/* In pill mode the mode selector is detached above the rounded
          container so it reads as separate chrome from the input. */}
      {pill ? modeBar : null}
      <div
        className={containerClassName}
        data-input-pill={pill ? "true" : undefined}
        data-multiline={isMultiLine ? "true" : "false"}
        data-expanded={expanded ? "true" : "false"}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={onContainerDrop}
      >
        {pill ? null : modeBar}
        {containerTop}
        <div className={inputRowClassName}>
          {inputRowStart}
          <textarea
            autoComplete="off"
            {...textareaProps}
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={onTextareaPaste}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
          />
          {inputRowEnd ? (
            <div className={styles.inputRowEnd}>{inputRowEnd}</div>
          ) : null}
          {isStreaming ? (
            <button
              type="button"
              className={`${styles.sendButton} ${styles.stopButton}`}
              onClick={onStop}
              aria-label={stopAriaLabel}
              title={stopTitle}
            >
              <span className={styles.stopIcon} />
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendButton}
              onClick={() => {
                if (canSubmit) onSubmit();
              }}
              disabled={!canSubmit}
              aria-label={sendAriaLabel}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {containerBottom ? (
          <div className={styles.containerBottomRow}>{containerBottom}</div>
        ) : null}
      </div>
      {(infoBarStart || infoBarEnd) && (
        <div className={styles.inputInfoBar}>
          {infoBarStart && (
            <span className={styles.infoBarStart}>{infoBarStart}</span>
          )}
          {infoBarEnd && (
            <span className={styles.infoBarEnd}>{infoBarEnd}</span>
          )}
        </div>
      )}
    </div>
  );
}

export const InputBarShell = memo(forwardRef<InputBarShellHandle, InputBarShellProps>(InputBarShellInner));
