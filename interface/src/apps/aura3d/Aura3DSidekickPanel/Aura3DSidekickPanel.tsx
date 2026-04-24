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
    <div className={styles.panel}>
      <h4 className={styles.heading}>Images</h4>
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
    </div>
  );
}

function ModelsPanel() {
  const images = useAura3DStore((s) => s.images);
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
    <div className={styles.panel}>
      <h4 className={styles.heading}>3D Models</h4>
      <div className={styles.grid}>
        {models.map((model) => {
        const sourceImage = images.find((img) => img.id === model.sourceImageId);
        return (
          <button
            key={model.id}
            type="button"
            className={`${styles.thumb} ${model.id === selectedModelId ? styles.thumbSelected : ""}`}
            onClick={() => selectModel(model.id)}
            title={model.polyCount != null ? `${model.polyCount.toLocaleString()} polys` : "3D Model"}
          >
            {sourceImage ? (
              <img src={sourceImage.imageUrl} alt="3D Model" className={styles.thumbImage} />
            ) : (
              <div className={styles.modelThumbPlaceholder}>
                <Box size={24} />
              </div>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}

export function Aura3DSidekickPanel() {
  const sidekickTab = useAura3DStore((s) => s.sidekickTab);

  if (sidekickTab === "models") return <ModelsPanel />;
  return <ImagesPanel />;
}
