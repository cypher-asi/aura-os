import { useCallback, useEffect, useRef } from "react";
import type { AttachmentItem } from "./ChatInputBar";
import { uploadFile } from "../../../api/upload";
import { api } from "../../../api/client";

export const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_UPLOAD_BYTES = 1_100_000;
const MAX_IMAGE_DIMENSION = 1536;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/sql",
  "application/x-sql",
  "text/sql",
];
const TEXT_EXTENSIONS = [".md", ".txt", ".markdown", ".json", ".sql"];

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
      try {
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
      } catch (err) {
        console.warn("[attach] processImageFile onload threw, dropping", { name: file.name, err });
        resolve(null);
      }
    };
    // Without an explicit onerror the Promise hangs forever on read failure
    // (e.g. when the clipboard hands us a synthetic File that the browser
    // can't actually fulfil). The hang fans out into `Promise.all` inside
    // `addFiles` and silently swallows every paste/drop/+ intake — exactly
    // the symptom we hit before this guard.
    reader.onerror = () => {
      console.warn("[attach] processImageFile FileReader error", { name: file.name, error: reader.error });
      resolve(null);
    };
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      console.warn("[attach] processImageFile readAsDataURL threw", { name: file.name, err });
      resolve(null);
    }
  });
}

function processTextFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
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
      } catch (err) {
        console.warn("[attach] processTextFile onload threw, dropping", { name: file.name, err });
        resolve(null);
      }
    };
    reader.onerror = () => {
      console.warn("[attach] processTextFile FileReader error", { name: file.name, error: reader.error });
      resolve(null);
    };
    try {
      reader.readAsText(file);
    } catch (err) {
      console.warn("[attach] processTextFile readAsText threw", { name: file.name, err });
      resolve(null);
    }
  });
}

export function processFile(file: File): Promise<AttachmentItem | null> {
  if (IMAGE_TYPES.includes(file.type)) return processImageFile(file);
  if (isTextFile(file)) return processTextFile(file);
  console.warn("[attach] processFile rejected: unsupported type", {
    name: file.name,
    type: file.type,
  });
  return Promise.resolve(null);
}

/** Convert base64 string to Blob for S3 upload. */
function base64ToBlob(base64: string, mediaType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

/** Fire-and-forget S3 upload for a single attachment. */
async function uploadAttachmentToS3(
  item: AttachmentItem,
  updateAttachment: (id: string, updates: Partial<AttachmentItem>) => void,
  signal: AbortSignal,
): Promise<void> {
  updateAttachment(item.id, { uploading: true, uploadProgress: 0 });
  try {
    const blob = base64ToBlob(item.data, item.mediaType);
    const fileUrl = await uploadFile(
      blob,
      item.name,
      item.mediaType,
      (percent) => updateAttachment(item.id, { uploadProgress: percent }),
      signal,
    );
    updateAttachment(item.id, { fileUrl, uploading: false, uploadProgress: 100 });
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : "Upload failed";
    console.warn("[upload] S3 upload failed, will fall back to base64:", message);
    updateAttachment(item.id, { uploading: false, uploadError: message });
  }
}

export function useFileAttachments(
  attachments: AttachmentItem[],
  onAttachmentsChange?: (items: AttachmentItem[]) => void,
  onRemoveAttachment?: (id: string) => void,
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>,
  /**
   * When set, `addFileFromPath` reads files via the remote-agent
   * filesystem API (`api.swarm.readRemoteFile`) instead of the local
   * desktop API. Mirrors the same routing the file explorer uses.
   */
  remoteAgentId?: string,
) {
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => { attachmentsRef.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); }, []);

  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  onAttachmentsChangeRef.current = onAttachmentsChange;

  /** Update a single attachment by id using the latest ref state. */
  const updateAttachment = useCallback((id: string, updates: Partial<AttachmentItem>) => {
    const updated = attachmentsRef.current.map((a) =>
      a.id === id ? { ...a, ...updates } : a,
    );
    attachmentsRef.current = updated;
    onAttachmentsChangeRef.current?.(updated);
  }, []);

  // Abort controllers for in-flight uploads, keyed by attachment id.
  const uploadAbortRefs = useRef<Map<string, AbortController>>(new Map());
  useEffect(() => () => {
    for (const controller of uploadAbortRefs.current.values()) controller.abort();
  }, []);

  const canAddMore = attachments.length < MAX_ATTACHMENTS;

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (!onAttachmentsChange) return;
    if (!canAddMore) return;
    const toAdd = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length);
    const results = await Promise.all(toAdd.map(processFile));
    const valid = results.filter((r): r is AttachmentItem => r !== null);
    if (valid.length) {
      void import("../../../lib/analytics").then(({ track }) =>
        track("file_attached", { file_count: valid.length }),
      );
      const next = [...attachments, ...valid];
      attachmentsRef.current = next;
      onAttachmentsChange(next);

      // Kick off S3 uploads in background (fire-and-forget).
      // The ref is already updated above so updateAttachment reads
      // the current array including the new items.
      for (const item of valid) {
        const controller = new AbortController();
        uploadAbortRefs.current.set(item.id, controller);
        void uploadAttachmentToS3(item, updateAttachment, controller.signal).finally(() => {
          uploadAbortRefs.current.delete(item.id);
        });
      }
    }
    // Defer to the next frame so the refocus lands after the native file
    // picker has released focus and React has committed the new attachment
    // chips — focusing synchronously here gets overridden and the input is
    // left unselected.
    requestAnimationFrame(() => textareaRef?.current?.focus());
  }, [attachments, canAddMore, onAttachmentsChange, updateAttachment, textareaRef]);

  /**
   * Read a project file by path and attach it as a text attachment.
   * Used by the @-mention autocomplete in the input bar; it skips the
   * `processFile` dispatch (which is gated on browser-supplied MIME
   * type / extension whitelist) because the user explicitly picked
   * this file from the project tree — so any text-readable extension
   * is fair game.
   */
  const addFileFromPath = useCallback(async (path: string) => {
    if (!onAttachmentsChange) return;
    if (!canAddMore) return;
    const name = path.split(/[\\/]/).pop() ?? path;
    if (attachmentsRef.current.some((a) => a.name === name && a.attachmentType === "text")) {
      // Re-pick of the same file is a no-op rather than a duplicate
      // attachment row; matches how the user mentally models @file.
      textareaRef?.current?.focus();
      return;
    }
    // Push a placeholder synchronously BEFORE the API read so the chip
    // appears immediately AND `isUploading` (which gates Enter-to-send)
    // flips true before the user can race-press Enter. Without this,
    // a fast user types `@foo`, hits Enter to pick the file, then hits
    // Enter again — the second Enter fires `handleSend` while the API
    // read is still in flight and the message goes out without the
    // file. Mirrors the synchronous registration `addFiles` already
    // gets via FileReader.
    const id = crypto.randomUUID();
    const placeholder: AttachmentItem = {
      id,
      file: new File([], name, { type: "text/plain" }),
      data: "",
      mediaType: "text/plain",
      name,
      attachmentType: "text",
      uploading: true,
      uploadProgress: 0,
    };
    let next = [...attachmentsRef.current, placeholder];
    attachmentsRef.current = next;
    onAttachmentsChange(next);

    const res = remoteAgentId
      ? await api.swarm.readRemoteFile(remoteAgentId, path)
      : await api.readFile(path);
    if (!res.ok || res.content == null) {
      // Drop the placeholder so the user isn't stuck with a phantom
      // chip they can't send through.
      next = attachmentsRef.current.filter((a) => a.id !== id);
      attachmentsRef.current = next;
      onAttachmentsChange(next);
      console.warn("[mention] readFile failed", { path, error: res.error });
      return;
    }
    const text = res.content;
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const mediaType = "text/plain";
    const file = new File([text], name, { type: mediaType });
    next = attachmentsRef.current.map((a) =>
      a.id === id ? { ...a, file, data: btoa(binary) } : a,
    );
    attachmentsRef.current = next;
    onAttachmentsChange(next);

    void import("../../../lib/analytics").then(({ track }) =>
      track("file_attached", { file_count: 1, source: "mention" }),
    );
    const realItem = next.find((a) => a.id === id);
    if (!realItem) return;
    const controller = new AbortController();
    uploadAbortRefs.current.set(id, controller);
    void uploadAttachmentToS3(realItem, updateAttachment, controller.signal).finally(() => {
      uploadAbortRefs.current.delete(id);
    });
    textareaRef?.current?.focus();
  }, [canAddMore, onAttachmentsChange, remoteAgentId, textareaRef, updateAttachment]);

  const handleRemove = useCallback((id: string) => {
    // Abort any in-flight upload for this attachment
    const controller = uploadAbortRefs.current.get(id);
    if (controller) {
      controller.abort();
      uploadAbortRefs.current.delete(id);
    }
    const a = attachments.find((x) => x.id === id);
    if (a?.preview) URL.revokeObjectURL(a.preview);
    onRemoveAttachment?.(id);
  }, [attachments, onRemoveAttachment]);

  return { canAddMore, addFiles, addFileFromPath, handleRemove };
}
