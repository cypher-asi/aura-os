import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import styles from "./Gallery.module.css";

export interface GalleryItem {
  id: string;
  src: string;
  alt?: string;
  /** When set, the gallery shows a Download button that fetches this URL. */
  downloadUrl?: string;
  /** Optional caption shown under the image (prompt, model, etc.). */
  caption?: string;
}

export interface GalleryProps {
  items: readonly GalleryItem[];
  initialId: string;
  onClose: () => void;
}

/**
 * Full-screen image gallery overlay shared across apps. Backdrop click
 * and ESC dismiss; left/right arrows or on-screen buttons navigate
 * between items. Renders into `document.body` so app-level stacking
 * contexts cannot clip it.
 */
export function Gallery({ items, initialId, onClose }: GalleryProps): React.ReactElement | null {
  const initialIndex = useMemo(() => {
    const idx = items.findIndex((item) => item.id === initialId);
    return idx >= 0 ? idx : 0;
  }, [initialId, items]);
  const [index, setIndex] = useState(initialIndex);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  const total = items.length;
  const goPrev = useCallback(() => {
    setIndex((curr) => ((curr - 1) % total + total) % total);
  }, [total]);
  const goNext = useCallback(() => {
    setIndex((curr) => (curr + 1) % total);
  }, [total]);

  useEffect(() => {
    if (total === 0) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.stopPropagation();
        goPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.stopPropagation();
        goNext();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onClose, total]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  if (total === 0) return null;

  const current = items[index] ?? items[0];
  const showNav = total > 1;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const overlay = (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Image gallery"
      onClick={handleBackdropClick}
      data-agent-surface="image-gallery"
    >
      <div className={styles.toolbar}>
        {current.downloadUrl ? (
          <a
            href={current.downloadUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className={styles.toolbarButton}
            aria-label="Download image"
          >
            <Download size={18} />
          </a>
        ) : null}
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.toolbarButton}
          onClick={onClose}
          aria-label="Close gallery"
        >
          <X size={20} />
        </button>
      </div>

      {showNav ? (
        <button
          type="button"
          className={`${styles.navButton} ${styles.navPrev}`}
          onClick={goPrev}
          aria-label="Previous image"
        >
          <ChevronLeft size={28} />
        </button>
      ) : null}

      <figure className={styles.figure} onClick={(e) => e.stopPropagation()}>
        <img
          key={current.id}
          src={current.src}
          alt={current.alt ?? ""}
          className={styles.image}
        />
        {current.caption ? (
          <figcaption className={styles.caption}>{current.caption}</figcaption>
        ) : null}
        {showNav ? (
          <div className={styles.counter} aria-live="polite">
            {index + 1} / {total}
          </div>
        ) : null}
      </figure>

      {showNav ? (
        <button
          type="button"
          className={`${styles.navButton} ${styles.navNext}`}
          onClick={goNext}
          aria-label="Next image"
        >
          <ChevronRight size={28} />
        </button>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}
