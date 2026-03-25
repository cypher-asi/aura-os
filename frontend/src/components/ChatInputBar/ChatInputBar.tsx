import { useRef, useState, useImperativeHandle, forwardRef, memo, useCallback, useEffect } from "react";
import { ArrowUp, Plus, X, FileText, ChevronDown } from "lucide-react";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useFileAttachments } from "./useFileAttachments";
import { AVAILABLE_MODELS, modelLabel } from "../../constants/models";
import { AgentEnvironment } from "../AgentEnvironment";
import styles from "../ChatView/ChatView.module.css";

export interface ChatInputBarHandle {
  focus: () => void;
}

export interface AttachmentItem {
  id: string;
  file: File;
  data: string;
  mediaType: string;
  name: string;
  attachmentType: "image" | "text";
  preview?: string;
}

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  onSend: (content: string, action?: string, attachments?: AttachmentItem[]) => void;
  onStop: () => void;
  streamKey: string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  agentName?: string;
  machineType?: "local" | "remote";
  attachments?: AttachmentItem[];
  onAttachmentsChange?: (items: AttachmentItem[]) => void;
  onRemoveAttachment?: (id: string) => void;
}

function AttachmentPreviews({ attachments, onRemove }: { attachments: AttachmentItem[]; onRemove: (id: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentPreviews}>
      {attachments.map((a) => (
        <div key={a.id} className={styles.attachmentThumb}>
          {a.preview ? <img src={a.preview} alt="" className={styles.attachmentThumbImg} /> : <FileText size={20} className={styles.attachmentFileIcon} />}
          <span className={styles.attachmentName}>{a.name}</span>
          <button type="button" className={styles.attachmentRemove} onClick={() => onRemove(a.id)} aria-label="Remove attachment"><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, Props>(function ChatInputBar({
  input, onInputChange, onSend, onStop, streamKey,
  selectedModel, onModelChange, machineType,
  attachments = [], onAttachmentsChange, onRemoveAttachment,
}, ref) {
  const isStreaming = useIsStreaming(streamKey);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }));

  const { canAddMore, addFiles, handleRemove } = useFileAttachments(attachments, onAttachmentsChange, onRemoveAttachment, textareaRef);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); addFiles(e.dataTransfer.files); }, [addFiles]);

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, []);

  useEffect(() => { autoResizeTextarea(); }, [input, autoResizeTextarea]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [modelMenuOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(input); }
  };

  return (
    <div className={styles.inputWrapper}>
      <div className={`${styles.inputContainer} ${isDragOver ? styles.dropZoneActive : ""}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <input ref={fileInputRef} type="file" accept="*/*" multiple className={styles.fileInputHidden} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <AttachmentPreviews attachments={attachments} onRemove={handleRemove} />
        <div className={styles.inputRow}>
          <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={!canAddMore} aria-label="Attach file"><Plus size={16} strokeWidth={1} /></button>
          <textarea ref={textareaRef} className={styles.textarea} value={input} onChange={(e) => onInputChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Add a follow-up" rows={1} />
          {isStreaming ? (
            <button type="button" className={`${styles.sendButton} ${styles.stopButton}`} onClick={onStop} aria-label="Stop"><span className={styles.stopIcon} /></button>
          ) : (
            <button type="button" className={styles.sendButton} onClick={() => onSend(input)} disabled={!input.trim() && attachments.length === 0} aria-label="Send"><ArrowUp size={16} /></button>
          )}
        </div>
      </div>
      <div className={styles.inputInfoBar}>
        {machineType && <><AgentEnvironment machineType={machineType} /><span className={styles.infoText}>·</span></>}
        <span className={styles.infoText}>/ for commands</span>
        <div className={styles.modelMenuWrap} ref={modelMenuRef}>
          <button type="button" className={styles.modelButton} onClick={() => setModelMenuOpen((v) => !v)}>
            {modelLabel(selectedModel ?? "")}<ChevronDown size={10} />
          </button>
          {modelMenuOpen && (
            <div className={styles.modelMenu}>
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.modelMenuItem} ${m.id === selectedModel ? styles.modelMenuItemActive : ""}`}
                  onClick={() => { onModelChange?.(m.id); setModelMenuOpen(false); }}
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
}));
