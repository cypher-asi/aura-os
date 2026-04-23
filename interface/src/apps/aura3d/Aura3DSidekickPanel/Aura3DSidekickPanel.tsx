import { useAura3DStore } from "../../../stores/aura3d-store";
import { ImageIcon, Box } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./Aura3DSidekickPanel.module.css";

function ImagesPanel() {
  const images = useAura3DStore((s) => s.images);
  const selectedImageId = useAura3DStore((s) => s.selectedImageId);
  const selectImage = useAura3DStore((s) => s.selectImage);

  if (images.length === 0) {
    return (
      <EmptyState icon={<ImageIcon size={24} />}>
        Generated images will appear here.
      </EmptyState>
    );
  }

  return (
    <div className={styles.grid}>
      {images.map((img) => (
        <button
          key={img.id}
          type="button"
          className={`${styles.thumb} ${img.id === selectedImageId ? styles.thumbSelected : ""}`}
          onClick={() => selectImage(img.id)}
          title={img.prompt}
        >
          <img src={img.imageUrl} alt={img.prompt} className={styles.thumbImage} />
        </button>
      ))}
    </div>
  );
}

function ModelsPanel() {
  const models = useAura3DStore((s) => s.models);
  const selectedModelId = useAura3DStore((s) => s.selectedModelId);
  const selectModel = useAura3DStore((s) => s.selectModel);

  if (models.length === 0) {
    return (
      <EmptyState icon={<Box size={24} />}>
        Generated 3D models will appear here.
      </EmptyState>
    );
  }

  return (
    <div className={styles.list}>
      {models.map((model) => (
        <button
          key={model.id}
          type="button"
          className={`${styles.modelItem} ${model.id === selectedModelId ? styles.modelItemSelected : ""}`}
          onClick={() => selectModel(model.id)}
        >
          <Box size={16} className={styles.modelIcon} />
          <div className={styles.modelInfo}>
            <span className={styles.modelLabel}>3D Model</span>
            {model.polyCount != null && (
              <span className={styles.modelMeta}>
                {model.polyCount.toLocaleString()} polys
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

export function Aura3DSidekickPanel() {
  const sidekickTab = useAura3DStore((s) => s.sidekickTab);

  if (sidekickTab === "models") return <ModelsPanel />;
  return <ImagesPanel />;
}
