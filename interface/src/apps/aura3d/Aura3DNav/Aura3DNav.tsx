import { Box } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./Aura3DNav.module.css";

export function Aura3DNav() {
  const images = useAura3DStore((s) => s.images);
  const selectedImageId = useAura3DStore((s) => s.selectedImageId);
  const selectImage = useAura3DStore((s) => s.selectImage);

  if (images.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState icon={<Box size={24} />}>
          Generate your first image to get started.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>Images</div>
      <div className={styles.list}>
        {images.map((image) => (
          <button
            key={image.id}
            type="button"
            className={`${styles.item} ${image.id === selectedImageId ? styles.itemActive : ""}`}
            onClick={() => selectImage(image.id)}
          >
            <img
              src={image.imageUrl}
              alt={image.prompt}
              className={styles.thumb}
            />
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>{image.prompt}</span>
              <span className={styles.itemMeta}>{image.model}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
