import { useRef, useState, useImperativeHandle, forwardRef, useCallback, useEffect } from "react";
import { ArrowUp, Plus, X, FileText } from "lucide-react";
import styles from "./ChatView.module.css";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_MB = 5;
const MAX_TOTAL_SIZE_MB = 10;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/x-markdown"];
const TEXT_EXTENSIONS = [".md", ".txt", ".markdown"];

const ACTIVE_MODEL_LABEL = "Opus 4.6";

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
  isStreaming: boolean;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  agentName?: string;
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
  attachments = [],
  onAttachmentsChange,
  onRemoveAttachment,
}, ref) {
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      attachmentsRef.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    },
    [],
  );

  const totalSizeMB = attachments.reduce((sum, a) => sum + a.file.size, 0) / (1024 * 1024);
  const canAddMore = attachments.length < MAX_ATTACHMENTS && totalSizeMB < MAX_TOTAL_SIZE_MB;

  const isTextFile = useCallback((file: File) => {
    if (TEXT_TYPES.includes(file.type)) return true;
    const lower = file.name.toLowerCase();
    return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }, []);

  const processFile = useCallback(
    (file: File): Promise<AttachmentItem | null> =>
      new Promise((resolve) => {
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          resolve(null);
          return;
        }
        if (IMAGE_TYPES.includes(file.type)) {
          const reader = new FileReader();
          reader.onload = () => {
            const data = reader.result as string;
            const base64 = data.split(",")[1] ?? "";
            resolve({
              id: crypto.randomUUID(),
              file,
              data: base64,
              mediaType: file.type,
              name: file.name,
              attachmentType: "image",
              preview: URL.createObjectURL(file),
            });
          };
          reader.readAsDataURL(file);
          return;
        }
        if (isTextFile(file)) {
          const reader = new FileReader();
          reader.onload = () => {
            const text = (reader.result as string) ?? "";
            const bytes = new TextEncoder().encode(text);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const mediaType = file.type || "text/plain";
            resolve({
              id: crypto.randomUUID(),
              file,
              data: base64,
              mediaType,
              name: file.name,
              attachmentType: "text",
            });
          };
          reader.readAsText(file);
          return;
        }
        resolve(null);
      }),
    [isTextFile],
  );

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !onAttachmentsChange || !canAddMore) return;
      const toAdd = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length);
      const results = await Promise.all(toAdd.map(processFile));
      const valid = results.filter((r): r is AttachmentItem => r !== null);
      if (valid.length) onAttachmentsChange([...attachments, ...valid]);
      textareaRef.current?.focus();
    },
    [attachments, canAddMore, onAttachmentsChange, processFile],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const a = attachments.find((x) => x.id === id);
      if (a?.preview) URL.revokeObjectURL(a.preview);
      onRemoveAttachment?.(id);
    },
    [attachments, onRemoveAttachment],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    autoResizeTextarea();
  }, [input, autoResizeTextarea]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(input);
    }
  };

  return (
    <div className={styles.inputWrapper}>
      <div
        className={`${styles.inputContainer} ${isDragOver ? styles.dropZoneActive : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          multiple
          className={styles.fileInputHidden}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {attachments.length > 0 && (
          <div className={styles.attachmentPreviews}>
            {attachments.map((a) => (
              <div key={a.id} className={styles.attachmentThumb}>
                {a.preview ? (
                  <img src={a.preview} alt="" className={styles.attachmentThumbImg} />
                ) : (
                  <FileText size={20} className={styles.attachmentFileIcon} />
                )}
                <span className={styles.attachmentName}>{a.name}</span>
                <button
                  type="button"
                  className={styles.attachmentRemove}
                  onClick={() => handleRemove(a.id)}
                  aria-label="Remove attachment"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.inputRow}>
          <button
            type="button"
            className={styles.attachButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={!canAddMore}
            aria-label="Attach file"
          >
            <Plus size={16} strokeWidth={1} />
          </button>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a follow-up"
            rows={1}
          />
          {isStreaming ? (
            <button
              type="button"
              className={`${styles.sendButton} ${styles.stopButton}`}
              onClick={onStop}
              aria-label="Stop"
            >
              <span className={styles.stopIcon} />
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendButton}
              onClick={() => onSend(input)}
              disabled={!input.trim() && attachments.length === 0}
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.inputInfoBar}>
        <span className={styles.modelButton}>{ACTIVE_MODEL_LABEL}</span>
        <span className={styles.infoDot}>·</span>
        <span className={styles.infoText}>/ for commands</span>
      </div>
    </div>
  );
});
