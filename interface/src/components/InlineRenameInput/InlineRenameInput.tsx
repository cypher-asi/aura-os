import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../ProjectList/ProjectList.module.css";

export interface InlineRenameTarget {
  id: string;
  name: string;
}

interface InlineRenameInputProps {
  target: InlineRenameTarget;
  onSave: (name: string) => void;
  onCancel: () => void;
}

const MAX_RETRIES = 10;
const RETRY_MS = 30;
const INLINE_RENAME_LABEL_SELECTOR = "[data-inline-rename-label]";
const INLINE_RENAME_WIDTH_BUFFER = 12;
const INLINE_RENAME_VIEWPORT_GUTTER = 16;

interface InlineRenameAnchorLayout {
  top: number;
  left: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  textAlign: string;
}

function hasLabelClass(element: Element): element is HTMLElement {
  return element instanceof HTMLElement
    && (element.getAttribute("class") ?? "").toLowerCase().includes("label");
}

function findLabelElement(id: string): { row: HTMLElement; label: HTMLElement } | null {
  const row = document.getElementById(id);
  if (!row) return null;
  const anchoredLabel = row.querySelector<HTMLElement>(INLINE_RENAME_LABEL_SELECTOR);
  if (anchoredLabel) {
    return { row, label: anchoredLabel };
  }
  const label = Array
    .from(row.querySelectorAll("*"))
    .find(hasLabelClass);
  if (!label) return null;
  return { row, label };
}

function buildAnchorLayout(label: HTMLElement): InlineRenameAnchorLayout {
  const rect = label.getBoundingClientRect();
  const computed = window.getComputedStyle(label);
  return {
    top: rect.top,
    left: rect.left,
    height: rect.height,
    minWidth: rect.width,
    maxWidth: Math.max(rect.width, window.innerWidth - rect.left - INLINE_RENAME_VIEWPORT_GUTTER),
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    color: computed.color,
    textAlign: computed.textAlign,
  };
}

function applyAnchorLayout(
  overlay: HTMLDivElement,
  input: HTMLInputElement,
  anchor: InlineRenameAnchorLayout,
  preserveWidth: boolean,
) {
  overlay.style.top = `${anchor.top}px`;
  overlay.style.left = `${anchor.left}px`;
  overlay.style.height = `${anchor.height}px`;
  input.style.caretColor = anchor.color;
  overlay.style.fontFamily = anchor.fontFamily;
  overlay.style.fontSize = anchor.fontSize;
  overlay.style.fontWeight = anchor.fontWeight;
  overlay.style.fontStyle = anchor.fontStyle;
  overlay.style.lineHeight = anchor.lineHeight;
  overlay.style.letterSpacing = anchor.letterSpacing;
  overlay.style.color = anchor.color;
  overlay.style.textAlign = anchor.textAlign;

  const idealWidth = Math.max(anchor.minWidth, Math.ceil(input.scrollWidth) + INLINE_RENAME_WIDTH_BUFFER);
  const currentWidth = preserveWidth
    ? Math.max(anchor.minWidth, parseFloat(overlay.style.width || "0") || 0)
    : anchor.minWidth;
  overlay.style.width = `${Math.min(Math.max(currentWidth, idealWidth), anchor.maxWidth)}px`;
  overlay.style.visibility = "visible";
}

export function InlineRenameInput({ target, onSave, onCancel }: InlineRenameInputProps) {
  const [value, setValue] = useState(target.name);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saved = useRef(false);
  const labelRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<InlineRenameAnchorLayout | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const updateInputLayout = useCallback(() => {
    const overlay = overlayRef.current;
    const input = inputRef.current;
    const anchor = anchorRef.current;
    if (!overlay || !input || !anchor) return;
    applyAnchorLayout(overlay, input, anchor, true);
  }, []);

  useEffect(() => {
    saved.current = false;
  }, [target.id, target.name]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    let attempt = 0;
    let rafId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    function tryPosition() {
      if (!input) return;
      const overlay = overlayRef.current;
      const found = findLabelElement(target.id);
      if (found && overlay) {
        labelRef.current = found.label;
        anchorRef.current = buildAnchorLayout(found.label);
        found.label.style.visibility = "hidden";
        applyAnchorLayout(overlay, input, anchorRef.current, false);
        input.focus();
        input.select();
        input.scrollLeft = 0;
        return;
      }

      attempt++;
      if (attempt >= MAX_RETRIES) {
        onCancelRef.current();
        return;
      }
      timerId = setTimeout(() => { rafId = requestAnimationFrame(tryPosition); }, RETRY_MS);
    }

    rafId = requestAnimationFrame(tryPosition);

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (timerId !== undefined) clearTimeout(timerId);
      if (labelRef.current) {
        labelRef.current.style.visibility = "";
        labelRef.current = null;
      }
      anchorRef.current = null;
    };
  }, [target.id]);

  useEffect(() => {
    updateInputLayout();
  }, [updateInputLayout, value]);

  const commit = useCallback(() => {
    if (saved.current) return;
    const nextValue = inputRef.current?.value ?? value;
    const trimmed = nextValue.trim();
    if (trimmed && trimmed !== target.name) {
      saved.current = true;
      onSave(trimmed);
    } else {
      onCancel();
    }
  }, [value, target.name, onSave, onCancel]);

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.inlineRenameOverlay}
      style={{ visibility: "hidden" }}
    >
      <span className={styles.inlineRenameMirror} aria-hidden="true">
        {value || " "}
      </span>
      <input
        ref={inputRef}
        className={styles.inlineRenameInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            commit();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={commit}
      />
    </div>,
    document.body,
  );
}
