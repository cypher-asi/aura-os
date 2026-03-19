import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
  const saved = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const row = document.getElementById(target.project_id);
    const label = row?.querySelector<HTMLElement>("[class*='label']");
    if (!label) return;

    const rect = label.getBoundingClientRect();
    input.style.top = `${rect.top}px`;
    input.style.left = `${rect.left}px`;
    input.style.width = `${rect.width}px`;
    input.style.height = `${rect.height}px`;
    input.style.visibility = "visible";
    label.style.visibility = "hidden";
    input.focus();
    input.select();

    return () => {
      label.style.visibility = "";
      input.style.visibility = "";
    };
  }, [target.project_id]);

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
