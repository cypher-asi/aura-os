import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AttachmentItem } from "./ChatInputBar";
import { uploadFile } from "../../../api/upload";
import { api } from "../../../api/client";
import { isPdf, isZip, unpackResearchZip } from "./research-attachments";
import { processFile } from "./process-attachment-file";
export { processFile } from "./process-attachment-file";

export const MAX_ATTACHMENTS = 5;

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
  /** Discard an intake finishing after the user switches conversations. */
  streamKey?: string,
) {
  const attachmentsRef = useRef(attachments);
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const intakeQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingIntakes = useRef(0);
  const activeStreamKey = useRef(streamKey);
  activeStreamKey.current = streamKey;
  // A passive effect can run after an upload completion and replace the
  // latest ref with an older rendered array, resurrecting "uploading" flags.
  // Synchronize at commit before asynchronous upload callbacks can run.
  useLayoutEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
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

  const canAddMore = attachments.length < MAX_ATTACHMENTS && !isProcessing;

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (!onAttachmentsChange) return;
    const selected = Array.from(files);
    const intakeStreamKey = activeStreamKey.current;
    pendingIntakes.current++;
    setIsProcessing(true);
    const intake = intakeQueue.current.then(async () => {
      if (intakeStreamKey !== activeStreamKey.current) return;
      const valid: AttachmentItem[] = [];
      const notices: string[] = [];
      setAttachmentNotice(null);
      for (const file of selected) {
        const slots = MAX_ATTACHMENTS - attachmentsRef.current.length - valid.length;
        if (slots <= 0) {
          notices.push(`${file.name}: the ${MAX_ATTACHMENTS}-attachment limit was reached. Attach it in another message.`);
          continue;
        }
        try {
          const expanded = isZip(file)
            ? await unpackResearchZip(file, slots)
            : { files: [file], notices: [] };
          notices.push(...expanded.notices.map((notice) => `${file.name}: ${notice}`));
          for (const entry of expanded.files) {
            try {
              const item = await processFile(entry);
              if (item) {
                valid.push(item);
                if (isPdf(entry)) notices.push(`${entry.name}: attached extracted PDF text; embedded images and layout are not included.`);
              } else {
                notices.push(`${entry.name}: could not read this file or its format is unsupported. Use images, PDF, TXT, Markdown, JSON, SQL, or ZIP containing these formats.`);
              }
            } catch (error) {
              notices.push(`${entry.name}: ${error instanceof Error ? error.message : "Could not read file."}`);
            }
          }
        } catch (error) {
          notices.push(`${file.name}: ${error instanceof Error ? error.message : "Could not read file."}`);
        }
      }
      if (intakeStreamKey !== activeStreamKey.current) {
        for (const item of valid) if (item.preview) URL.revokeObjectURL(item.preview);
        return;
      }
      if (valid.length) {
        void import("../../../lib/analytics").then(({ track }) =>
          track("file_attached", { file_count: valid.length }),
        );
        const next = [...attachmentsRef.current, ...valid];
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
      if (notices.length) setAttachmentNotice(notices.join("\n"));
      // Defer to the next frame so the refocus lands after the native file
      // picker has released focus and React has committed the new attachment
      // chips — focusing synchronously here gets overridden and the input is
      // left unselected.
      requestAnimationFrame(() => textareaRef?.current?.focus());
    });
    intakeQueue.current = intake.catch(() => {});
    try {
      await intake;
    } finally {
      pendingIntakes.current--;
      if (pendingIntakes.current === 0) setIsProcessing(false);
    }
  }, [onAttachmentsChange, updateAttachment, textareaRef]);

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

  return { canAddMore, addFiles, addFileFromPath, handleRemove, isProcessing, attachmentNotice };
}
