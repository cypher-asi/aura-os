import { memo } from "react";
import { FileText, X } from "lucide-react";
import type { AttachmentItem } from "../ChatInputBar";
import styles from "./AttachmentPreviews.module.css";

export interface AttachmentPreviewsProps {
  attachments: readonly AttachmentItem[];
  onRemove: (id: string) => void;
}

/**
 * Thumbnail strip for the input bar's pending attachments, rendered in
 * the container-top slot above the textarea. Uploading items dim until
 * their S3 upload settles.
 */
export const AttachmentPreviews = memo(function AttachmentPreviews({
  attachments,
  onRemove,
}: AttachmentPreviewsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentPreviews}>
      {attachments.map((a) => (
        <div
          key={a.id}
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
      ))}
    </div>
  );
});
