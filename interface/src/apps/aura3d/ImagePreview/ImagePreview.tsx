import type { MouseEvent } from "react";
import { ImageIcon } from "lucide-react";
import { Spinner } from "@cypher-asi/zui";
import { useGallery } from "../../../components/Gallery";
import styles from "./ImagePreview.module.css";

interface ImagePreviewProps {
  imageUrl?: string | null;
  partialData?: string | null;
  isLoading?: boolean;
  progress?: number;
  progressMessage?: string;
  /**
   * Right-click handler forwarded to the rendered `<img>`. Opt-in so
   * preview surfaces that don't own a delete action (e.g. lightbox-only
   * stock previews) don't accidentally suppress the native menu.
   */
  onImageContextMenu?: (event: MouseEvent<HTMLImageElement>) => void;
}

export function ImagePreview({
  imageUrl,
  partialData,
  isLoading,
  progress,
  progressMessage,
  onImageContextMenu,
}: ImagePreviewProps) {
  const displayUrl = partialData || imageUrl;
  const { openGallery } = useGallery();

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
      <div className={`${styles.root} ${styles.rootEmpty}`} data-agent-surface="aura3d-image-preview-empty">
        <div className={styles.emptyState}>
          <ImageIcon size={32} className={styles.emptyIcon} />
          <span className={styles.emptyText}>Your generated image will appear here</span>
        </div>
      </div>
    );
  }

  const handleOpenGallery = (): void => {
    if (isLoading) return;
    openGallery({
      items: [
        {
          id: "aura3d-preview",
          src: displayUrl,
          alt: "Generated asset",
          downloadUrl: displayUrl,
        },
      ],
      initialId: "aura3d-preview",
    });
  };

  return (
    <div className={styles.root} data-agent-surface="aura3d-image-preview" data-agent-proof="generated-image-preview">
      <img
        src={displayUrl}
        alt="Generated asset"
        className={`${styles.image} ${partialData && isLoading ? styles.imagePartial : ""}`}
        onClick={handleOpenGallery}
        onContextMenu={onImageContextMenu}
        style={{ cursor: isLoading ? "default" : "zoom-in" }}
      />
      {isLoading && (
        <div className={styles.overlay}>
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}
