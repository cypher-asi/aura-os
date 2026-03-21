import { useCallback, useEffect, useRef } from "react";
import type { AttachmentItem } from "./ChatInputBar";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_MB = 5;
const MAX_TOTAL_SIZE_MB = 10;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/x-markdown"];
const TEXT_EXTENSIONS = [".md", ".txt", ".markdown"];

function isTextFile(file: File): boolean {
  if (TEXT_TYPES.includes(file.type)) return true;
  return TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function processImageFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      resolve({
        id: crypto.randomUUID(), file,
        data: data.split(",")[1] ?? "",
        mediaType: file.type, name: file.name,
        attachmentType: "image",
        preview: URL.createObjectURL(file),
      });
    };
    reader.readAsDataURL(file);
  });
}

function processTextFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = (reader.result as string) ?? "";
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      resolve({
        id: crypto.randomUUID(), file,
        data: btoa(binary),
        mediaType: file.type || "text/plain", name: file.name,
        attachmentType: "text",
      });
    };
    reader.readAsText(file);
  });
}

export function processFile(file: File): Promise<AttachmentItem | null> {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) return Promise.resolve(null);
  if (IMAGE_TYPES.includes(file.type)) return processImageFile(file);
  if (isTextFile(file)) return processTextFile(file);
  return Promise.resolve(null);
}

export function useFileAttachments(
  attachments: AttachmentItem[],
  onAttachmentsChange?: (items: AttachmentItem[]) => void,
  onRemoveAttachment?: (id: string) => void,
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>,
) {
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => { attachmentsRef.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); }, []);

  const totalSizeMB = attachments.reduce((sum, a) => sum + a.file.size, 0) / (1024 * 1024);
  const canAddMore = attachments.length < MAX_ATTACHMENTS && totalSizeMB < MAX_TOTAL_SIZE_MB;

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length || !onAttachmentsChange || !canAddMore) return;
    const toAdd = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length);
    const results = await Promise.all(toAdd.map(processFile));
    const valid = results.filter((r): r is AttachmentItem => r !== null);
    if (valid.length) onAttachmentsChange([...attachments, ...valid]);
    textareaRef?.current?.focus();
  }, [attachments, canAddMore, onAttachmentsChange, textareaRef]);

  const handleRemove = useCallback((id: string) => {
    const a = attachments.find((x) => x.id === id);
    if (a?.preview) URL.revokeObjectURL(a.preview);
    onRemoveAttachment?.(id);
  }, [attachments, onRemoveAttachment]);

  return { canAddMore, addFiles, handleRemove };
}
