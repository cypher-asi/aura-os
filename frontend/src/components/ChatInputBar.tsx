import { useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { ArrowUp, Square, ChevronDown } from "lucide-react";
import { useClickOutside } from "../hooks/use-click-outside";
import styles from "./ChatView.module.css";

const MODEL_OPTIONS: Record<string, string> = {
  "opus-4.6": "Opus 4.6",
  "gpt-5.3-codex": "GPT 5.3 Codex",
};

const modelMenuItems: MenuItem[] = [
  { id: "opus-4.6", label: "Opus 4.6" },
  { id: "gpt-5.3-codex", label: "GPT 5.3 Codex" },
];

export interface ChatInputBarHandle {
  focus: () => void;
}

export interface AttachmentItem {
  id: string;
  file: File;
  data: string;
  mediaType: string;
  name: string;
  preview?: string;
}

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  onSend: (content: string, action?: string, attachments?: AttachmentItem[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
  attachments?: AttachmentItem[];
  onAttachmentsChange?: (items: AttachmentItem[]) => void;
  onRemoveAttachment?: (id: string) => void;
}

export const ChatInputBar = forwardRef<ChatInputBarHandle, Props>(function ChatInputBar({
  input,
  onInputChange,
  onSend,
  onStop,
  isStreaming,
  selectedModel,
  onModelChange,
  attachments = [],
  onAttachmentsChange: _onAttachmentsChange,
  onRemoveAttachment: _onRemoveAttachment,
}, ref) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  useClickOutside(modelMenuRef, () => setModelMenuOpen(false), modelMenuOpen);

  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(input);
    }
  };

  return (
    <div className={styles.inputWrapper}>
      <div className={styles.inputContainer}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={input}
          onChange={(e) => {
            onInputChange(e.target.value);
            autoResizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message AURA..."
          rows={1}
        />
        <div className={styles.inputToolbar}>
          <div className={styles.toolbarLeft}>
            <div ref={modelMenuRef} className={styles.modelMenuWrap}>
              <button
                type="button"
                className={styles.modelButton}
                onClick={() => setModelMenuOpen((v) => !v)}
              >
                {MODEL_OPTIONS[selectedModel]} <ChevronDown size={12} />
              </button>
              {modelMenuOpen && (
                <div className={styles.modelMenu}>
                  <Menu
                    items={modelMenuItems}
                    value={selectedModel}
                    onChange={(id) => {
                      onModelChange(id);
                      setModelMenuOpen(false);
                    }}
                    background="solid"
                    border="solid"
                    rounded="md"
                    width={180}
                    isOpen
                  />
                </div>
              )}
            </div>
          </div>
          <div className={styles.toolbarRight}>
            {isStreaming ? (
              <button
                type="button"
                className={`${styles.sendButton} ${styles.stopButton}`}
                onClick={onStop}
                aria-label="Stop"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => onSend(input)}
                disabled={!input.trim() && attachments.length === 0}
                aria-label="Send"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
