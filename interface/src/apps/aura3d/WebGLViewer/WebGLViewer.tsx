import { useRef, useEffect, useState } from "react";
import { Spinner } from "@cypher-asi/zui";
import { createScene, disposeScene, type SceneContext } from "./scene-setup";
import { loadModel, disposeModel, applyWireframe, applyTextures, type LoadedModel } from "./model-loader";
import styles from "./WebGLViewer.module.css";

interface WebGLViewerProps {
  glbUrl: string;
  showGrid?: boolean;
  showWireframe?: boolean;
  showTexture?: boolean;
}

export function WebGLViewer({
  glbUrl,
  showGrid = true,
  showWireframe = false,
  showTexture = true,
}: WebGLViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCtxRef = useRef<SceneContext | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = createScene(containerRef.current);
    sceneCtxRef.current = ctx;

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      ctx.controls.update();
      ctx.renderer.render(ctx.scene, ctx.camera);
    };
    animate();

    const container = containerRef.current;
    const observer = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      ctx.camera.aspect = w / h;
      ctx.camera.updateProjectionMatrix();
      ctx.renderer.setSize(w, h);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      if (modelRef.current) {
        disposeModel(modelRef.current, ctx.scene);
        modelRef.current = null;
      }
      disposeScene(ctx, container);
      sceneCtxRef.current = null;
    };
  }, []);

  // Load model when URL changes
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx || !glbUrl) return;

    // Dispose previous model
    if (modelRef.current) {
      disposeModel(modelRef.current, ctx.scene);
      modelRef.current = null;
    }

    setIsLoading(true);
    setError(null);

    loadModel(glbUrl, ctx.scene, ctx.camera, ctx.controls)
      .then((loaded) => {
        modelRef.current = loaded;
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });
  }, [glbUrl]);

  // Toggle grid
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;
    if (ctx.gridHelper) {
      ctx.gridHelper.visible = showGrid;
    }
  }, [showGrid]);

  // Toggle wireframe
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    if (showWireframe) {
      applyWireframe(model.object, true);
    } else {
      applyTextures(model.object, showTexture, model.originalMaterials);
    }
  }, [showWireframe, showTexture]);

  return (
    <div ref={containerRef} className={styles.container}>
      {isLoading && (
        <div className={styles.overlay}>
          <Spinner size="md" />
          <span className={styles.overlayText}>Loading 3D model...</span>
        </div>
      )}
      {error && (
        <div className={styles.overlay}>
          <span className={styles.errorText}>{error}</span>
        </div>
      )}
    </div>
  );
}
