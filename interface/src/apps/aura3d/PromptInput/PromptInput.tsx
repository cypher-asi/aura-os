import { useRef, useState, useEffect, type KeyboardEvent } from "react";
import { ArrowUp, ChevronDown } from "lucide-react";
import { Spinner } from "@cypher-asi/zui";
import { IMAGE_MODELS } from "../../../constants/models";
import styles from "./PromptInput.module.css";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
  disabled?: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Describe your 3D asset...",
  disabled = false,
  selectedModel,
  onModelChange,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading && !disabled) {
        onSubmit();
      }
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelMenuOpen]);

  const selectedLabel =
    IMAGE_MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel;

  return (
    <div className={styles.root}>
      <div className={styles.inputContainer}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading || disabled}
          rows={1}
        />
        <button
          type="button"
          className={styles.sendButton}
          onClick={onSubmit}
          disabled={!value.trim() || isLoading || disabled}
          aria-label="Generate"
        >
          {isLoading ? <Spinner size="sm" /> : <ArrowUp size={14} />}
        </button>
      </div>
      <div className={styles.infoBar}>
        <div className={styles.modelMenuWrap} ref={modelMenuRef}>
          <button
            type="button"
            className={styles.modelButton}
            onClick={() => setModelMenuOpen((v) => !v)}
          >
            {selectedLabel}
            <ChevronDown size={10} />
          </button>
          {modelMenuOpen && (
            <div className={styles.modelMenu}>
              {IMAGE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.modelMenuItem} ${m.id === selectedModel ? styles.modelMenuItemActive : ""}`}
                  onClick={() => {
                    onModelChange(m.id);
                    setModelMenuOpen(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
