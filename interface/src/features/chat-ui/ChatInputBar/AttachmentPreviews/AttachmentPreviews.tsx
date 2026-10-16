import { memo } from "react";
import { FileText, X } from "lucide-react";
import type { AttachmentItem } from "../ChatInputBar";
import { hasUploadedImage } from "../attachment-upload-state";
import styles from "./AttachmentPreviews.module.css";

export interface AttachmentPreviewsProps {
  attachments: readonly AttachmentItem[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}

/**
 * Thumbnail strip for the input bar's pending attachments, rendered in
 * the container-top slot above the textarea. Uploading items dim until
 * their S3 upload settles.
 */
export const AttachmentPreviews = memo(function AttachmentPreviews({
  attachments,
  onRemove,
  onRetry,
}: AttachmentPreviewsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentPreviews}>
      {attachments.map((a) => (
        <div key={a.id} className={styles.attachmentItem}>
          <div
            className={styles.attachmentThumb}
            style={a.uploading ? { opacity: 0.5 } : undefined}
          >
            {a.preview ? (
              <img src={a.preview} alt="" className={styles.attachmentThumbImg} />
            ) : (
              <FileText size={20} className={styles.attachmentFileIcon} />
            )}
            <span className={styles.attachmentName}>{a.name}</span>
            <button
              type="button"
              className={styles.attachmentRemove}
              onClick={() => onRemove(a.id)}
              aria-label="Remove attachment"
            >
              <X size={12} />
            </button>
          </div>
          {a.uploading ? <span role="status">Uploading {a.name}… {a.uploadProgress ?? 0}%</span> : null}
          {!a.uploading && (a.uploadError || (a.attachmentType === "image" && !hasUploadedImage(a))) ? (
            <div className={styles.uploadError}>
              <span role="alert">
                {a.name}: {a.uploadError ? `Upload failed (${a.uploadError}).` : "Upload required."}{" "}
                {a.attachmentType === "image" ? "Retry or remove this photo before sending chat." : "Text is still available inline."}
              </span>
              {onRetry ? (
                <button type="button" className={styles.uploadRetry} onClick={() => onRetry(a.id)} aria-label={`Retry upload ${a.name}`}>
                  Retry upload
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
});
