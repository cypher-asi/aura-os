import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
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
import { useInputAutosize } from "./useInputAutosize";

export const ENTER_SUBMIT_GRACE_MS = 100;

interface PendingEnterSubmit {
  valueBeforeEnter: string;
  selectionStart: number;
  selectionEnd: number;
  timerId: number;
}

function valueWithPendingNewline(
  valueBeforeEnter: string,
  nextValue: string,
  selectionStart: number,
  selectionEnd: number,
): string {
  const prefix = valueBeforeEnter.slice(0, selectionStart);
  const suffix = valueBeforeEnter.slice(selectionEnd);
  if (
    !nextValue.startsWith(prefix) ||
    !nextValue.endsWith(suffix) ||
    nextValue.length < prefix.length + suffix.length
  ) {
    return nextValue;
  }

  const insertedText = nextValue.slice(
    prefix.length,
    nextValue.length - suffix.length,
  );
  if (!insertedText) return nextValue;
  return `${prefix}\n${insertedText}${suffix}`;
}

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
  /**
   * Slot rendered at the start of the controls (e.g. attach button).
   * Single-line: anchored in the input row's bottom-left corner.
   * Multi-line: rendered as the first item of the bottom controls row.
   */
  inputRowStart?: ReactNode;
  /**
   * Slot rendered inside the input row at the end, before send/stop.
   * Only shown while single-line; multi-line consumers relocate their
   * end-content into `containerBottom` (see `onMultiLineChange`).
   */
  inputRowEnd?: ReactNode;
  /**
   * Whether the wrap measurement should reserve the inline end-slot's
   * width. The single/multi-line decision is always measured against the
   * SINGLE-LINE layout, so this must stay constant across the multi-line
   * flip — pass the state-independent "would the consumer show inline
   * end content while single-line?" answer here (e.g. chat passes
   * `hasPicker && !councilActive`). Defaults to `inputRowEnd != null`,
   * which is correct for consumers that never relocate the slot.
   */
  reserveInlineEnd?: boolean;
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
    reserveInlineEnd,
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
  const contentMirrorRef = useRef<HTMLDivElement>(null);
  const baselineMirrorRef = useRef<HTMLDivElement>(null);
  const pendingEnterSubmitRef = useRef<PendingEnterSubmit | null>(null);
  const isMultiLine = useInputAutosize(
    { textareaRef, contentMirrorRef, baselineMirrorRef },
    value,
  );

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    blur: () => textareaRef.current?.blur(),
    getTextarea: () => textareaRef.current,
  }));

  useEffect(() => {
    onMultiLineChange?.(isMultiLine);
  }, [isMultiLine, onMultiLineChange]);

  const sendEnabled = isSendEnabled ?? value.trim().length > 0;
  const canSubmit = sendEnabled && !disabled;

  const clearPendingEnterSubmit = useCallback(() => {
    const pending = pendingEnterSubmitRef.current;
    if (pending) {
      window.clearTimeout(pending.timerId);
      pendingEnterSubmitRef.current = null;
    }
  }, []);

  useEffect(() => clearPendingEnterSubmit, [clearPendingEnterSubmit]);

  useEffect(() => {
    if (!canSubmit) clearPendingEnterSubmit();
  }, [canSubmit, clearPendingEnterSubmit]);

  const submitImmediately = useCallback(() => {
    clearPendingEnterSubmit();
    if (canSubmit) onSubmit();
  }, [canSubmit, clearPendingEnterSubmit, onSubmit]);

  const handleValueChange = useCallback(
    (nextValue: string) => {
      const pending = pendingEnterSubmitRef.current;
      if (!pending) {
        onValueChange(nextValue);
        return;
      }

      window.clearTimeout(pending.timerId);
      pendingEnterSubmitRef.current = null;
      onValueChange(
        valueWithPendingNewline(
          pending.valueBeforeEnter,
          nextValue,
          pending.selectionStart,
          pending.selectionEnd,
        ),
      );
    },
    [onValueChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      onTextareaKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!canSubmit) return;
        clearPendingEnterSubmit();

        const textarea = e.currentTarget;
        const selectionStart = textarea.selectionStart ?? value.length;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const timerId = window.setTimeout(() => {
          pendingEnterSubmitRef.current = null;
          onSubmit();
        }, ENTER_SUBMIT_GRACE_MS);

        pendingEnterSubmitRef.current = {
          valueBeforeEnter: value,
          selectionStart,
          selectionEnd,
          timerId,
        };
      }
    },
    [onTextareaKeyDown, canSubmit, clearPendingEnterSubmit, onSubmit, value],
  );

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

  const showInlineEnd = !isMultiLine && inputRowEnd != null;

  const inputRowClassName = [
    styles.inputRow,
    showInlineEnd ? styles.inputRowHasEnd : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The wrap-measurement mirrors keep the single-line layout's insets in
  // every state, so the reserve flag must not depend on `isMultiLine`
  // (see `reserveInlineEnd` prop docs).
  const mirrorClassName = [
    styles.sizeMirror,
    (reserveInlineEnd ?? inputRowEnd != null) ? styles.sizeMirrorHasEnd : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sendStopButton = isStreaming ? (
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
      onClick={submitImmediately}
      disabled={!canSubmit}
      aria-label={sendAriaLabel}
    >
      <ArrowUp size={16} />
    </button>
  );

  // Multi-line: every control lives in the bottom row — start slot
  // (attach), the consumer's `containerBottom` content (model picker,
  // chips), then send/stop right-aligned — and the textarea above gets
  // the full container width. Single-line keeps the corner-anchored
  // controls and only renders the bottom row when the consumer filled
  // the slot (e.g. council fan-out, command chips).
  const bottomRow =
    isMultiLine || containerBottom ? (
      <div className={styles.containerBottomRow}>
        {isMultiLine ? inputRowStart : null}
        {containerBottom ? (
          <div className={styles.containerBottomSlot}>{containerBottom}</div>
        ) : null}
        {isMultiLine ? sendStopButton : null}
      </div>
    ) : null;

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
          {isMultiLine ? null : inputRowStart}
          <textarea
            autoComplete="off"
            {...textareaProps}
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={(e) => handleValueChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={onTextareaPaste}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
          />
          {/* Hidden wrap-measurement mirrors (see useInputAutosize). The
              trailing zero-width space makes a trailing newline measure
              as a second line, matching where the textarea's caret sits. */}
          <div
            ref={contentMirrorRef}
            className={mirrorClassName}
            data-autosize-mirror="content"
            aria-hidden="true"
          >
            {`${value}\u200b`}
          </div>
          <div
            ref={baselineMirrorRef}
            className={mirrorClassName}
            data-autosize-mirror="baseline"
            aria-hidden="true"
          >
            {"\u200b"}
          </div>
          {showInlineEnd ? (
            <div className={styles.inputRowEnd}>{inputRowEnd}</div>
          ) : null}
          {isMultiLine ? null : sendStopButton}
        </div>
        {bottomRow}
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
