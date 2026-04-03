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

function findLabelElement(id: string): { row: HTMLElement; label: HTMLElement } | null {
  const row = document.getElementById(id);
  if (!row) return null;
  const label = row.querySelector<HTMLElement>("[class*='label']");
  if (!label) return null;
  return { row, label };
}

export function InlineRenameInput({ target, onSave, onCancel }: InlineRenameInputProps) {
  const [value, setValue] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const saved = useRef(false);
  const labelRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

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
        const rect = found.label.getBoundingClientRect();
        input.style.top = `${rect.top}px`;
        input.style.left = `${rect.left}px`;
        input.style.width = `${rect.width}px`;
        input.style.height = `${rect.height}px`;
        input.style.visibility = "visible";
        found.label.style.visibility = "hidden";
        input.focus();
        input.select();
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

  const commit = useCallback(() => {
    if (saved.current) return;
    const trimmed = value.trim();
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
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onCancel(); }}
      onBlur={commit}
    />,
    document.body,
  );
}
