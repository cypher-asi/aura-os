import type { AttachmentItem } from "./ChatInputBar";

export function hasUploadedImage(item: AttachmentItem): boolean {
  if (!item.fileUrl) return false;
  try {
    const url = new URL(item.fileUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname;
  } catch {
    return false;
  }
}

/** Chat snapshots must use durable image references, not a large inline fallback. */
export function hasUnuploadedImages(attachments: readonly AttachmentItem[]): boolean {
  return attachments.some((item) => item.attachmentType === "image" && !hasUploadedImage(item));
}
