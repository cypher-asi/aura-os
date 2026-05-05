import { useRef, useEffect, useState } from "react";
import { Spinner } from "@cypher-asi/zui";
import {
  applyViewerTheme,
  createScene,
  disposeScene,
  readViewerTheme,
  type SceneContext,
} from "./scene-setup";
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
    // Coalesce resize ticks into a single RAF and render synchronously
    // inside that frame. Without this the canvas shows one or more
    // blank/stretched frames between `setSize()` and the animation
    // loop's next paint, which reads as flicker while dragging the
    // window edge.
    let resizeRafId: number | null = null;
    let pendingW = 0;
    let pendingH = 0;
    const flushResize = () => {
      resizeRafId = null;
      const w = pendingW;
      const h = pendingH;
      if (w === 0 || h === 0) return;
      ctx.camera.aspect = w / h;
      ctx.camera.updateProjectionMatrix();
      // `updateStyle=false` keeps the canvas tracking the container's
      // CSS box (we set `width:100%; height:100%` in the stylesheet)
      // instead of forcing inline sizes that fight the flex layout.
      ctx.renderer.setSize(w, h, false);
      ctx.renderer.render(ctx.scene, ctx.camera);
    };
    const observer = new ResizeObserver(() => {
      if (!container) return;
      pendingW = container.clientWidth;
      pendingH = container.clientHeight;
      if (resizeRafId != null) return;
      resizeRafId = requestAnimationFrame(flushResize);
    });
    observer.observe(container);

    // Track <html data-theme> so the scene background and grid swap
    // when the user toggles light/dark without a full remount.
    const themeObserver = new MutationObserver(() => {
      const next = readViewerTheme();
      applyViewerTheme(ctx, next);
      ctx.renderer.render(ctx.scene, ctx.camera);
    });
    if (typeof document !== "undefined") {
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      if (resizeRafId != null) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
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
