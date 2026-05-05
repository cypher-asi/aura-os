import { useCallback, useEffect, useState } from "react";
import { ModalConfirm, Spinner } from "@cypher-asi/zui";
import {
  useAura3DStore,
  type Generated3DModel,
  type GeneratedImage,
} from "../../../stores/aura3d-store";
import { ImageIcon, Box } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../../components/SidekickItemContextMenu";
import styles from "./Aura3DSidekickPanel.module.css";

/**
 * Renders the 3D model tile thumbnail, walking three fallbacks:
 *   1. The captured GLB snapshot stored on the server filesystem
 *      (`/api/artifacts/:id/thumbnail`). This is the primary case
 *      after the user opens a model at least once.
 *   2. The source image used to generate the model, when available
 *      in the in-memory `images` store. Used for models the user
 *      hasn't opened yet (no PNG on disk) but whose source image is
 *      still loaded for this project.
 *   3. The cube `Box` icon, which appears only when neither of the
 *      above is reachable (e.g. server still warming up + user
 *      switched projects mid-load).
 *
 * Each step is implemented with a separate `<img onError>` so the
 * browser will *try* the captured thumbnail first; a 404 from the
 * server transparently flips to the source image without any
 * additional roundtrip. We track `step` in component state so a
 * temporary network blip on the snapshot URL doesn't permanently
 * downgrade the tile to the source-image view across re-renders.
 */
function ModelThumb({
  model,
  sourceImage,
}: {
  model: Generated3DModel;
  sourceImage: GeneratedImage | undefined;
}) {
  type Step = "thumbnail" | "source" | "placeholder";

  const initialStep: Step = model.thumbnailUrl
    ? "thumbnail"
    : sourceImage?.imageUrl
      ? "source"
      : "placeholder";
  const [step, setStep] = useState<Step>(initialStep);

  // Reset to the highest-priority source whenever the model's
  // thumbnail URL changes (e.g. just-uploaded after the user opened
  // it in the viewer). Without this, a previously-404'd tile would
  // remain stuck on its source-image fallback even after the
  // captured PNG appeared on disk.
  useEffect(() => {
    setStep(initialStep);
  }, [model.thumbnailUrl, sourceImage?.imageUrl, initialStep]);

  if (step === "thumbnail" && model.thumbnailUrl) {
    return (
      <img
        src={model.thumbnailUrl}
        alt="3D Model"
        className={styles.thumbImage}
        onError={() =>
          setStep(sourceImage?.imageUrl ? "source" : "placeholder")
        }
      />
    );
  }
  if (step === "source" && sourceImage?.imageUrl) {
    return (
      <img
        src={sourceImage.imageUrl}
        alt="3D Model"
        className={styles.thumbImage}
        onError={() => setStep("placeholder")}
      />
    );
  }
  return (
    <div className={styles.modelThumbPlaceholder}>
      <Box size={24} />
    </div>
  );
}

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

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleAction = useCallback(
    (action: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target) return;
      if (action === "delete") {
        setPendingDeleteId(target.id);
      }
    },
    [menu, closeMenu],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    void deleteImage(pendingDeleteId);
    setPendingDeleteId(null);
  }, [pendingDeleteId, deleteImage]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

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
      <ModalConfirm
        isOpen={pendingDeleteId !== null}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Image"
        message="Delete this generated image? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
      />
    </div>
  );
}

function ModelsPanel() {
  const images = useAura3DStore((s) => s.images);
  const models = useAura3DStore((s) => s.models);
  const selectedModelId = useAura3DStore((s) => s.selectedModelId);
  const selectModel = useAura3DStore((s) => s.selectModel);
  const deleteModel = useAura3DStore((s) => s.deleteModel);
  const isGenerating3D = useAura3DStore((s) => s.isGenerating3D);
  const generateSourceImage = useAura3DStore((s) => s.generateSourceImage);

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

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleAction = useCallback(
    (action: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target) return;
      if (action === "delete") {
        setPendingDeleteId(target.id);
      }
    },
    [menu, closeMenu],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    void deleteModel(pendingDeleteId);
    setPendingDeleteId(null);
  }, [pendingDeleteId, deleteModel]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  if (models.length === 0 && !isGenerating3D) {
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
        {isGenerating3D && (
          // Pending placeholder pinned at the front of the 3D gallery
          // while a generation is in flight. Shows the source image as
          // its base (matching how completed model thumbs render) with
          // a spinner overlay so the user has a concrete "selected"
          // target the moment they click Generate. Non-interactive
          // <div> so it sits outside the `model:<id>` context-menu
          // resolver above.
          <div
            className={`${styles.thumb} ${styles.thumbSelected} ${styles.thumbPending}`}
            data-agent-surface="aura3d-model-pending-thumb"
            data-agent-proof="model-generation-pending"
            aria-label="Generating new 3D model"
            role="img"
          >
            {generateSourceImage ? (
              <>
                <img
                  src={generateSourceImage.imageUrl}
                  alt=""
                  className={`${styles.thumbImage} ${styles.thumbImageDim}`}
                />
                <div className={styles.thumbSpinnerOverlay}>
                  <Spinner size="sm" />
                </div>
              </>
            ) : (
              <Spinner size="sm" />
            )}
          </div>
        )}
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
              <ModelThumb model={model} sourceImage={sourceImage} />
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
      <ModalConfirm
        isOpen={pendingDeleteId !== null}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete 3D Model"
        message="Delete this 3D model? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
      />
    </div>
  );
}

export function Aura3DSidekickPanel() {
  const sidekickTab = useAura3DStore((s) => s.sidekickTab);

  if (sidekickTab === "models") return <ModelsPanel />;
  return <ImagesPanel />;
}
