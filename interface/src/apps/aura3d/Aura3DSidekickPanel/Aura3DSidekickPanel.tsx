import { useCallback } from "react";
import { Spinner } from "@cypher-asi/zui";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { ImageIcon, Box } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../../components/SidekickItemContextMenu";
import styles from "./Aura3DSidekickPanel.module.css";

function ImagesPanel() {
  const images = useAura3DStore((s) => s.images);
  const selectedImageId = useAura3DStore((s) => s.selectedImageId);
  const selectImage = useAura3DStore((s) => s.selectImage);
  const deleteImage = useAura3DStore((s) => s.deleteImage);
  const isGeneratingImage = useAura3DStore((s) => s.isGeneratingImage);
  const partialImageData = useAura3DStore((s) => s.partialImageData);

  // The hook resolves the right-clicked thumb by `<button id={img.id}>`.
  // We prefix the id so a stray click on a placeholder element with the
  // same DOM id (unlikely but possible) does not accidentally open the
  // delete menu for another item.
  const resolveItem = useCallback(
    (nodeId: string) => {
      if (!nodeId.startsWith("image:")) return null;
      const id = nodeId.slice("image:".length);
      return images.find((img) => img.id === id) ?? null;
    },
    [images],
  );

  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu({ resolveItem });

  const handleAction = useCallback(
    (action: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target) return;
      if (action === "delete") {
        void deleteImage(target.id);
      }
    },
    [menu, closeMenu, deleteImage],
  );

  if (images.length === 0 && !isGeneratingImage) {
    return (
      <EmptyState icon={<ImageIcon size={24} />}>
        Generated images will appear here.
      </EmptyState>
    );
  }

  return (
    <div
      className={styles.panel}
      data-agent-surface="aura3d-image-gallery"
      data-agent-proof="generated-image-gallery"
      onContextMenu={handleContextMenu}
    >
      <h4 className={styles.heading}>Images</h4>
      <div className={styles.grid}>
        {isGeneratingImage && (
          // Pending placeholder pinned at the front of the gallery while
          // a generation is in flight. Rendered as a non-interactive div
          // (not a button) so it sits outside the `image:<id>` context-
          // menu resolver above. Promotes to the streamed partial image
          // once the model emits one; otherwise shows a spinner so the
          // sidekick has something concrete to anchor "selected".
          <div
            className={`${styles.thumb} ${styles.thumbSelected} ${styles.thumbPending}`}
            data-agent-surface="aura3d-image-pending-thumb"
            data-agent-proof="image-generation-pending"
            aria-label="Generating new image"
            role="img"
          >
            {partialImageData ? (
              <img
                src={partialImageData}
                alt=""
                className={styles.thumbImage}
              />
            ) : (
              <Spinner size="sm" />
            )}
          </div>
        )}
        {images.map((img) => (
          <button
            key={img.id}
            id={`image:${img.id}`}
            type="button"
            className={`${styles.thumb} ${img.id === selectedImageId ? styles.thumbSelected : ""}`}
            onClick={() => selectImage(img.id)}
            title={img.prompt}
          >
            <img src={img.imageUrl} alt={img.prompt} className={styles.thumbImage} />
          </button>
        ))}
      </div>
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleAction}
          actions={["delete"]}
        />
      )}
    </div>
  );
}

function ModelsPanel() {
  const images = useAura3DStore((s) => s.images);
  const models = useAura3DStore((s) => s.models);
  const selectedModelId = useAura3DStore((s) => s.selectedModelId);
  const selectModel = useAura3DStore((s) => s.selectModel);
  const deleteModel = useAura3DStore((s) => s.deleteModel);

  const resolveItem = useCallback(
    (nodeId: string) => {
      if (!nodeId.startsWith("model:")) return null;
      const id = nodeId.slice("model:".length);
      return models.find((m) => m.id === id) ?? null;
    },
    [models],
  );

  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu({ resolveItem });

  const handleAction = useCallback(
    (action: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target) return;
      if (action === "delete") {
        void deleteModel(target.id);
      }
    },
    [menu, closeMenu, deleteModel],
  );

  if (models.length === 0) {
    return (
      <EmptyState icon={<Box size={24} />}>
        Generated 3D models will appear here.
      </EmptyState>
    );
  }

  return (
    <div
      className={styles.panel}
      data-agent-surface="aura3d-model-gallery"
      data-agent-proof="generated-model-gallery"
      onContextMenu={handleContextMenu}
    >
      <h4 className={styles.heading}>3D Models</h4>
      <div className={styles.grid}>
        {models.map((model) => {
          const sourceImage = images.find((img) => img.id === model.sourceImageId);
          return (
            <button
              key={model.id}
              id={`model:${model.id}`}
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
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleAction}
          actions={["delete"]}
        />
      )}
    </div>
  );
}

export function Aura3DSidekickPanel() {
  const sidekickTab = useAura3DStore((s) => s.sidekickTab);

  if (sidekickTab === "models") return <ModelsPanel />;
  return <ImagesPanel />;
}
