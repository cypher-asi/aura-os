import { useCallback, useRef } from "react";
import { useAura3DStore, STYLE_LOCK_SUFFIX } from "../../../stores/aura3d-store";
import { generateImageStream } from "../../../api/streams";
import { EventType } from "../../../types/aura-events";
import { ImagePreview } from "../ImagePreview";
import { PromptInput } from "../PromptInput";
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

  const abortRef = useRef<AbortController | null>(null);

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
      selectedProjectId ?? undefined,
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
    <div className={styles.root}>
      <div className={styles.previewArea}>
        <ImagePreview
          imageUrl={currentImage?.imageUrl}
          partialData={partialImageData}
          isLoading={isGeneratingImage}
          progress={imageProgress}
          progressMessage={imageProgressMessage}
        />
      </div>
      <PromptInput
        value={imaginePrompt}
        onChange={setImaginePrompt}
        onSubmit={handleGenerate}
        isLoading={isGeneratingImage}
        disabled={!selectedProjectId}
        placeholder={selectedProjectId ? "Describe your 3D asset..." : "Select a project first"}
        selectedModel={imagineModel}
        onModelChange={setImagineModel}
      />
    </div>
  );
}
