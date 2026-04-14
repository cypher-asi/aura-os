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

function syncInputToLabel(input: HTMLInputElement, label: HTMLElement) {
  const rect = label.getBoundingClientRect();
  const computed = window.getComputedStyle(label);
  const maxWidth = Math.max(rect.width, window.innerWidth - rect.left - INLINE_RENAME_VIEWPORT_GUTTER);

  input.style.top = `${rect.top}px`;
  input.style.left = `${rect.left}px`;
  input.style.height = `${rect.height}px`;
  input.style.fontFamily = computed.fontFamily;
  input.style.fontSize = computed.fontSize;
  input.style.fontWeight = computed.fontWeight;
  input.style.fontStyle = computed.fontStyle;
  input.style.lineHeight = computed.lineHeight;
  input.style.letterSpacing = computed.letterSpacing;
  input.style.color = computed.color;
  input.style.textAlign = computed.textAlign;

  input.style.width = "0px";
  const idealWidth = Math.max(rect.width, Math.ceil(input.scrollWidth) + INLINE_RENAME_WIDTH_BUFFER);
  input.style.width = `${Math.min(idealWidth, maxWidth)}px`;
  input.style.visibility = "visible";
}

export function InlineRenameInput({ target, onSave, onCancel }: InlineRenameInputProps) {
  const [value, setValue] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const saved = useRef(false);
  const labelRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const updateInputLayout = useCallback(() => {
    const input = inputRef.current;
    const label = labelRef.current;
    if (!input || !label) return;
    syncInputToLabel(input, label);
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
      const found = findLabelElement(target.id);
      if (found) {
        labelRef.current = found.label;
        found.label.style.visibility = "hidden";
        syncInputToLabel(input, found.label);
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
    <input
      ref={inputRef}
      className={styles.inlineRenameInput}
      style={{ visibility: "hidden" }}
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
    />,
    document.body,
  );
}
