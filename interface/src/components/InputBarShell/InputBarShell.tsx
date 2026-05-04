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

  /** Slot rendered inside the container, above the input row. */
  containerTop?: ReactNode;
  /** Slot rendered inside the input row at the start (e.g. attach button). */
  inputRowStart?: ReactNode;
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
    isPulsing = false,
    isDropZone = false,
    isStatic = false,
    placeholder,
    disabled = false,
    textareaProps,
    onTextareaKeyDown,
    onTextareaPaste,
    onContainerDragOver,
    onContainerDragLeave,
    onContainerDrop,
    containerTop,
    inputRowStart,
    infoBarStart,
    infoBarEnd,
    sendAriaLabel = "Send",
    stopAriaLabel = "Stop",
    stopTitle,
    rootProps,
  }: InputBarShellProps,
  ref: Ref<InputBarShellHandle>,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    blur: () => textareaRef.current?.blur(),
    getTextarea: () => textareaRef.current,
  }));

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Cap the inline height to match the CSS max-height so the textarea's
    // own scrollbar engages for long messages (and native caret-follow on
    // Arrow keys keeps working).
    const cap = Math.min(window.innerHeight * 0.7, 800);
    el.style.height = Math.min(el.scrollHeight, cap) + "px";
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  useEffect(() => {
    const onResize = () => autoResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [autoResize]);

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
    isDropZone ? styles.dropZoneActive : "",
    isPulsing || isCentered ? styles.inputContainerPulse : "",
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
      <div
        className={containerClassName}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={onContainerDrop}
      >
        {containerTop}
        <div className={styles.inputRow}>
          {inputRowStart}
          <textarea
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
