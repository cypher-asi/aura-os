import { useCallback, useEffect, useRef } from "react";
import type { AttachmentItem } from "./ChatInputBar";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_MB = 5;
const MAX_TOTAL_SIZE_MB = 10;
const MAX_IMAGE_UPLOAD_BYTES = 1_100_000;
const MAX_IMAGE_DIMENSION = 1536;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/x-markdown"];
const TEXT_EXTENSIONS = [".md", ".txt", ".markdown"];

function isTextFile(file: File): boolean {
  if (TEXT_TYPES.includes(file.type)) return true;
  return TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1] ?? "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl: string): Promise<{ data: string; mediaType: string }> {
  const originalBase64 = dataUrlToBase64(dataUrl);
  if (originalBase64.length <= Math.ceil(MAX_IMAGE_UPLOAD_BYTES * 4 / 3)) {
    const mediaType = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
    return { data: originalBase64, mediaType };
  }

  const image = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { data: originalBase64, mediaType: "image/png" };
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", IMAGE_JPEG_QUALITY),
  );
  if (!blob) return { data: originalBase64, mediaType: "image/png" };
  const compressedDataUrl = await blobToDataUrl(blob);
  const compressedBase64 = dataUrlToBase64(compressedDataUrl);
  if (compressedBase64.length >= originalBase64.length) {
    const mediaType = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
    return { data: originalBase64, mediaType };
  }
  return { data: compressedBase64, mediaType: "image/jpeg" };
}

function processImageFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result as string;
      const processed = await compressImageDataUrl(data).catch(() => ({
        data: dataUrlToBase64(data),
        mediaType: file.type,
      }));
      resolve({
        id: crypto.randomUUID(), file,
        data: processed.data,
        mediaType: processed.mediaType, name: file.name,
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
    if (valid.length) {
      void import("../../../../lib/analytics").then(({ track }) =>
        track("file_attached", { file_count: valid.length }),
      );
      onAttachmentsChange([...attachments, ...valid]);
    }
    textareaRef?.current?.focus();
  }, [attachments, canAddMore, onAttachmentsChange, textareaRef]);

  const handleRemove = useCallback((id: string) => {
    const a = attachments.find((x) => x.id === id);
    if (a?.preview) URL.revokeObjectURL(a.preview);
    onRemoveAttachment?.(id);
  }, [attachments, onRemoveAttachment]);

  return { canAddMore, addFiles, handleRemove };
}
