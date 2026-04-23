import { useCallback, useRef } from "react";
import { Box, Grid3x3, Triangle, Paintbrush } from "lucide-react";
import { Button, Spinner, Toggle } from "@cypher-asi/zui";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { generate3dStream } from "../../../api/streams";
import { EventType } from "../../../types/aura-events";
import { EmptyState } from "../../../components/EmptyState";
import { WebGLViewer } from "../WebGLViewer";
import styles from "./ModelGeneration.module.css";

export function ModelGeneration() {
  const generateSourceImage = useAura3DStore((s) => s.generateSourceImage);
  const isGenerating3D = useAura3DStore((s) => s.isGenerating3D);
  const generate3DProgress = useAura3DStore((s) => s.generate3DProgress);
  const generate3DProgressMessage = useAura3DStore((s) => s.generate3DProgressMessage);
  const current3DModel = useAura3DStore((s) => s.current3DModel);

  const showGrid = useAura3DStore((s) => s.showGrid);
  const showWireframe = useAura3DStore((s) => s.showWireframe);
  const showTexture = useAura3DStore((s) => s.showTexture);
  const toggleGrid = useAura3DStore((s) => s.toggleGrid);
  const toggleWireframe = useAura3DStore((s) => s.toggleWireframe);
  const toggleTexture = useAura3DStore((s) => s.toggleTexture);

  const setGenerating3D = useAura3DStore((s) => s.setGenerating3D);
  const set3DProgress = useAura3DStore((s) => s.set3DProgress);
  const complete3DGeneration = useAura3DStore((s) => s.complete3DGeneration);
  const setError = useAura3DStore((s) => s.setError);

  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate3D = useCallback(() => {
    if (!generateSourceImage) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating3D(true);

    generate3dStream(
      generateSourceImage.imageUrl,
      undefined,
      {
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case EventType.GenerationStart:
              set3DProgress(0, "Starting 3D generation...");
              break;
            case EventType.GenerationProgress:
              set3DProgress(event.content.percent, event.content.message);
              break;
            case EventType.GenerationCompleted:
              if (event.content.glbUrl) {
                complete3DGeneration({
                  id: `model-${Date.now()}`,
                  sourceImageId: generateSourceImage.id,
                  sourceImageUrl: generateSourceImage.imageUrl,
                  glbUrl: event.content.glbUrl,
                  polyCount: event.content.polyCount,
                  taskId: "",
                  createdAt: new Date().toISOString(),
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
    );
  }, [generateSourceImage, setGenerating3D, set3DProgress, complete3DGeneration, setError]);

  if (!generateSourceImage && !current3DModel) {
    return (
      <div className={styles.root}>
        <EmptyState icon={<Box size={32} />}>
          Generate an image, then convert it to a 3D model.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {current3DModel && (
          <div className={styles.viewerControls}>
            <Toggle checked={showGrid} onChange={toggleGrid} size="sm" />
            <Grid3x3 size={12} className={styles.controlIcon} />
            <Toggle checked={showWireframe} onChange={toggleWireframe} size="sm" />
            <Triangle size={12} className={styles.controlIcon} />
            <Toggle checked={showTexture} onChange={toggleTexture} size="sm" />
            <Paintbrush size={12} className={styles.controlIcon} />
            {current3DModel.polyCount != null && (
              <span className={styles.polyCount}>
                {current3DModel.polyCount.toLocaleString()} polys
              </span>
            )}
          </div>
        )}
      </div>
      <div className={styles.viewerArea}>
        {current3DModel ? (
          <WebGLViewer
            glbUrl={current3DModel.glbUrl}
            showGrid={showGrid}
            showWireframe={showWireframe}
            showTexture={showTexture}
          />
        ) : generateSourceImage ? (
          <div className={styles.sourcePreview}>
            <img
              src={generateSourceImage.imageUrl}
              alt="Source for 3D generation"
              className={styles.sourceImage}
            />
          </div>
        ) : null}
      </div>
      <div className={styles.actionBar}>
        <Button
          variant="primary"
          onClick={handleGenerate3D}
          disabled={!generateSourceImage || isGenerating3D}
        >
          {isGenerating3D ? (
            <>
              <Spinner size="sm" />
              <span>{generate3DProgressMessage || `${generate3DProgress}%`}</span>
            </>
          ) : (
            "Generate 3D"
          )}
        </Button>
      </div>
    </div>
  );
}
