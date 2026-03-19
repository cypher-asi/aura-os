import { useEffect, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../types";
import styles from "./ProjectList.module.css";

interface InlineRenameInputProps {
  target: Project;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function InlineRenameInput({ target, onSave, onCancel }: InlineRenameInputProps) {
  const [value, setValue] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const saved = useRef(false);
  const labelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const row = document.getElementById(target.project_id);
    const label = row?.querySelector<HTMLElement>("[class*='label']");
    if (label) {
      labelRef.current = label;
      setRect(label.getBoundingClientRect());
      label.style.visibility = "hidden";
    }
    return () => {
      if (labelRef.current) labelRef.current.style.visibility = "";
    };
  }, [target.project_id]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [rect]);

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

  if (!rect) return null;
  return createPortal(
    <input
      ref={inputRef}
      className={styles.inlineRenameInput}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onCancel(); }}
      onBlur={commit}
    />,
    document.body,
  );
}
