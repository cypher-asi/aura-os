import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ModalConfirm } from "@cypher-asi/zui";
import { useAura3DStore, STYLE_LOCK_SUFFIX } from "../../../stores/aura3d-store";
import { generateImageStream } from "../../../api/streams";
import { EventType } from "../../../shared/types/aura-events";
import { ImagePreview } from "../ImagePreview";
import { PromptInput } from "../PromptInput";
import { SidekickItemContextMenu } from "../../../components/SidekickItemContextMenu";
import styles from "./ImageGeneration.module.css";

export function ImageGeneration() {
  const selectedProjectId = useAura3DStore((s) => s.selectedProjectId);
  const imaginePrompt = useAura3DStore((s) => s.imaginePrompt);
  const setImaginePrompt = useAura3DStore((s) => s.setImaginePrompt);
  const imagineModel = useAura3DStore((s) => s.imagineModel);
  const setImagineModel = useAura3DStore((s) => s.setImagineModel);
  const isGeneratingImage = useAura3DStore((s) => s.isGeneratingImage);
  const imageProgress = useAura3DStore((s) => s.imageProgress);
  const imageProgressMessage = useAura3DStore((s) => s.imageProgressMessage);
  const partialImageData = useAura3DStore((s) => s.partialImageData);
  const currentImage = useAura3DStore((s) => s.currentImage);

  const setGeneratingImage = useAura3DStore((s) => s.setGeneratingImage);
  const setImageProgress = useAura3DStore((s) => s.setImageProgress);
  const setPartialImageData = useAura3DStore((s) => s.setPartialImageData);
  const completeImageGeneration = useAura3DStore((s) => s.completeImageGeneration);
  const setError = useAura3DStore((s) => s.setError);
  const deleteImage = useAura3DStore((s) => s.deleteImage);

  const abortRef = useRef<AbortController | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape teardown for the main-panel context menu.
  // The shared sidekick hook can't be reused here because it resolves
  // its target via DOM node ids; the main-panel preview is a single
  // fixed target tracked by `currentImage`.
  useEffect(() => {
    if (!menuPos) return;
    const handleClick = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPos(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuPos]);

  const handleImageContextMenu = useCallback(
    (e: MouseEvent<HTMLImageElement>) => {
      if (!currentImage) return;
      e.preventDefault();
      setMenuPos({ x: e.clientX, y: e.clientY });
    },
    [currentImage],
  );

  const handleMenuAction = useCallback(
    (action: string) => {
      const target = currentImage;
      setMenuPos(null);
      if (!target) return;
      if (action === "delete") {
        setPendingDeleteId(target.id);
      }
    },
    [currentImage],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    void deleteImage(pendingDeleteId);
    setPendingDeleteId(null);
  }, [pendingDeleteId, deleteImage]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const handleGenerate = useCallback(() => {
    const prompt = imaginePrompt.trim();
    if (!prompt) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fullPrompt = prompt + STYLE_LOCK_SUFFIX;

    setGeneratingImage(true);

    generateImageStream(
      fullPrompt,
      imagineModel,
      undefined,
      {
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case EventType.GenerationStart:
              setImageProgress(0, "Starting image generation...");
              break;
            case EventType.GenerationProgress:
              setImageProgress(
                event.content.percent,
                event.content.message,
              );
              break;
            case EventType.GenerationPartialImage:
              setPartialImageData(event.content.data);
              break;
            case EventType.GenerationCompleted:
              if (event.content.imageUrl) {
                completeImageGeneration({
                  id: `img-${Date.now()}`,
                  artifactId: event.content.artifactId,
                  prompt,
                  imageUrl: event.content.imageUrl,
                  originalUrl: event.content.originalUrl ?? event.content.imageUrl,
                  model: imagineModel,
                  createdAt: new Date().toISOString(),
                  meta: event.content.meta,
                });
                void import("../../../lib/analytics").then(({ track }) =>
                  track("aura3d_image_generated", { model: imagineModel }),
                );
              }
              break;
            case EventType.GenerationError:
              setError(event.content.message);
              break;
          }
        },
        onError: (err) => {
          if (!controller.signal.aborted) {
            setError(String(err));
          }
        },
      },
      controller.signal,
      selectedProjectId ? { projectId: selectedProjectId } : undefined,
    );
  }, [
    imaginePrompt,
    imagineModel,
    selectedProjectId,
    setGeneratingImage,
    setImageProgress,
    setPartialImageData,
    completeImageGeneration,
    setError,
  ]);

  return (
    <div className={styles.root} data-agent-surface="aura3d-image-generation">
      <div
        className={styles.previewArea}
        data-agent-surface="aura3d-image-preview-area"
        data-agent-proof={currentImage?.imageUrl || partialImageData ? "generated-image-visible" : undefined}
      >
        <ImagePreview
          imageUrl={currentImage?.imageUrl}
          partialData={partialImageData}
          isLoading={isGeneratingImage}
          progress={imageProgress}
          progressMessage={imageProgressMessage}
          onImageContextMenu={handleImageContextMenu}
        />
        {menuPos && currentImage && (
          <SidekickItemContextMenu
            x={menuPos.x}
            y={menuPos.y}
            menuRef={menuRef}
            onAction={handleMenuAction}
            actions={["delete"]}
          />
        )}
      </div>
      <PromptInput
        value={imaginePrompt}
        onChange={setImaginePrompt}
        onSubmit={handleGenerate}
        isLoading={isGeneratingImage}
        disabled={!selectedProjectId}
        placeholder={selectedProjectId ? "Describe a static image of what your desired 3D model." : "Select a project first"}
        selectedModel={imagineModel}
        onModelChange={setImagineModel}
      />
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
