import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Box, Grid3x3, Triangle, Paintbrush } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { generate3dStream } from "../../../api/streams";
import { EventType } from "../../../shared/types/aura-events";
import { MODEL_3D_MODELS } from "../../../constants/models";
import { EmptyState } from "../../../components/EmptyState";
import { SidekickItemContextMenu } from "../../../components/SidekickItemContextMenu";
import { PromptInput } from "../PromptInput";
import { WebGLViewer } from "../WebGLViewer";
import styles from "./ModelGeneration.module.css";

const PROGRESS_MESSAGES = [
  "Generating 3D model...",
  "Still cooking...",
  "Almost there...",
  "Putting on the finishing touches...",
];
const PROGRESS_INTERVAL_MS = 25_000;

function useProgressMessage(isGenerating: boolean): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isGenerating) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1));
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isGenerating]);

  return PROGRESS_MESSAGES[index];
}

export function ModelGeneration() {
  const selectedProjectId = useAura3DStore((s) => s.selectedProjectId);
  const generateSourceImage = useAura3DStore((s) => s.generateSourceImage);
  const isGenerating3D = useAura3DStore((s) => s.isGenerating3D);
  const current3DModel = useAura3DStore((s) => s.current3DModel);
  const model3DPrompt = useAura3DStore((s) => s.model3DPrompt);
  const setModel3DPrompt = useAura3DStore((s) => s.setModel3DPrompt);
  const model3DModel = useAura3DStore((s) => s.model3DModel);
  const setModel3DModel = useAura3DStore((s) => s.setModel3DModel);
  const progressMessage = useProgressMessage(isGenerating3D);

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
  const deleteImage = useAura3DStore((s) => s.deleteImage);
  const deleteModel = useAura3DStore((s) => s.deleteModel);

  const abortRef = useRef<AbortController | null>(null);

  type MenuTarget =
    | { kind: "image"; id: string }
    | { kind: "model"; id: string };
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: MenuTarget;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menu]);

  const handleSourceContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!generateSourceImage) return;
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        target: { kind: "image", id: generateSourceImage.id },
      });
    },
    [generateSourceImage],
  );

  const handleViewerContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!current3DModel) return;
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        target: { kind: "model", id: current3DModel.id },
      });
    },
    [current3DModel],
  );

  const handleMenuAction = useCallback(
    (action: string) => {
      const target = menu?.target;
      setMenu(null);
      if (!target) return;
      if (action !== "delete") return;
      if (target.kind === "image") {
        void deleteImage(target.id);
      } else {
        void deleteModel(target.id);
      }
    },
    [menu, deleteImage, deleteModel],
  );

  const handleGenerate3D = useCallback(() => {
    if (!generateSourceImage) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating3D(true);

    const trimmedPrompt = model3DPrompt.trim();
    generate3dStream(
      generateSourceImage.imageUrl,
      trimmedPrompt || undefined,
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
                void import("../../../lib/analytics").then(({ track }) =>
                  track("aura3d_model_generated"),
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
      selectedProjectId ?? undefined,
      generateSourceImage.artifactId,
    );
  }, [generateSourceImage, model3DPrompt, selectedProjectId, setGenerating3D, set3DProgress, complete3DGeneration, setError]);

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
    <div
      className={styles.root}
      data-agent-surface="aura3d-model-generation"
    >
      <div className={styles.viewerArea}>
        {current3DModel ? (
          <div
            className={styles.viewerWrapper}
            onContextMenu={handleViewerContextMenu}
          >
            <WebGLViewer
              glbUrl={current3DModel.glbUrl}
              showGrid={showGrid}
              showWireframe={showWireframe}
              showTexture={showTexture}
            />
            <div className={styles.viewerControls}>
              <button
                type="button"
                className={`${styles.controlButton} ${showGrid ? styles.controlButtonActive : ""}`}
                onClick={toggleGrid}
                title="Toggle grid"
              >
                <Grid3x3 size={14} />
              </button>
              <button
                type="button"
                className={`${styles.controlButton} ${showWireframe ? styles.controlButtonActive : ""}`}
                onClick={toggleWireframe}
                title="Toggle wireframe"
              >
                <Triangle size={14} />
              </button>
              <button
                type="button"
                className={`${styles.controlButton} ${showTexture ? styles.controlButtonActive : ""}`}
                onClick={toggleTexture}
                title="Toggle textures"
              >
                <Paintbrush size={14} />
              </button>
              {current3DModel.polyCount != null && (
                <span className={styles.polyCount}>
                  {current3DModel.polyCount.toLocaleString()} polys
                </span>
              )}
            </div>
          </div>
        ) : generateSourceImage ? (
          <div
            className={styles.sourcePreview}
            data-agent-surface="aura3d-source-image-for-3d"
            onContextMenu={handleSourceContextMenu}
          >
            <img
              src={generateSourceImage.imageUrl}
              alt="Source for 3D generation"
              className={styles.sourceImage}
              data-agent-surface="aura3d-source-image-proof"
              data-agent-proof="source-image-ready-for-3d"
            />
          </div>
        ) : null}
        {menu && (
          <SidekickItemContextMenu
            x={menu.x}
            y={menu.y}
            menuRef={menuRef}
            onAction={handleMenuAction}
            actions={["delete"]}
          />
        )}
      </div>
      {!current3DModel && (
        <PromptInput
          value={model3DPrompt}
          onChange={setModel3DPrompt}
          onSubmit={handleGenerate3D}
          isLoading={isGenerating3D}
          disabled={!generateSourceImage || !selectedProjectId}
          placeholder={
            isGenerating3D
              ? progressMessage
              : !generateSourceImage
                ? "Generate an image first"
                : !selectedProjectId
                  ? "Select a project first"
                  : "Refine your 3D model (optional)"
          }
          selectedModel={model3DModel}
          onModelChange={setModel3DModel}
          models={MODEL_3D_MODELS}
          requireText={false}
        />
      )}
    </div>
  );
}
