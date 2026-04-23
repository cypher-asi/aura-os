import { ImageIcon } from "lucide-react";
import { Spinner } from "@cypher-asi/zui";
import styles from "./ImagePreview.module.css";

interface ImagePreviewProps {
  imageUrl?: string | null;
  partialData?: string | null;
  isLoading?: boolean;
  progress?: number;
  progressMessage?: string;
}

export function ImagePreview({
  imageUrl,
  partialData,
  isLoading,
  progress,
  progressMessage,
}: ImagePreviewProps) {
  const displayUrl = partialData || imageUrl;

  if (isLoading && !displayUrl) {
    return (
      <div className={styles.root}>
        <div className={styles.loadingState}>
          <Spinner size="md" />
          <span className={styles.loadingText}>
            {progressMessage || `Generating${progress ? ` (${progress}%)` : ""}...`}
          </span>
        </div>
      </div>
    );
  }

  if (!displayUrl) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyState}>
          <ImageIcon size={32} className={styles.emptyIcon} />
          <span className={styles.emptyText}>Your generated image will appear here</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <img
        src={displayUrl}
        alt="Generated asset"
        className={`${styles.image} ${partialData && isLoading ? styles.imagePartial : ""}`}
      />
      {isLoading && (
        <div className={styles.overlay}>
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}
