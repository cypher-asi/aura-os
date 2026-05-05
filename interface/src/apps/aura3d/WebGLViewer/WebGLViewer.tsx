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
  /**
   * Fires once after the model finishes loading and the camera has
   * framed it, with a PNG snapshot of the rendered scene. Wired by
   * the AURA 3D page to upload the snapshot as the artifact's
   * sidekick thumbnail. The viewer dedupes per `glbUrl` so toggling
   * wireframe/texture or re-rendering does not retrigger upload.
   */
  onThumbnailReady?: (blob: Blob) => void;
}

export function WebGLViewer({
  glbUrl,
  showGrid = true,
  showWireframe = false,
  showTexture = true,
  onThumbnailReady,
}: WebGLViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCtxRef = useRef<SceneContext | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const animationIdRef = useRef<number | null>(null);
  // Track which `glbUrl` we have already snapped a thumbnail for so
  // re-renders (theme swap, control toggles, prop changes) cannot
  // retrigger the upload. Cleared whenever `glbUrl` changes.
  const capturedUrlRef = useRef<string | null>(null);
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

    capturedUrlRef.current = null;
    setIsLoading(true);
    setError(null);

    loadModel(glbUrl, ctx.scene, ctx.camera, ctx.controls)
      .then((loaded) => {
        modelRef.current = loaded;
        setIsLoading(false);
        // Capture a sidekick thumbnail of the freshly-loaded model.
        // We wait one frame so OrbitControls can settle the framing
        // call from `loadModel` (camera position + target update),
        // then render synchronously and pull a PNG off the canvas.
        // The capture is gated on `glbUrl` so it only ever fires once
        // per model per mount, even if React re-runs the effect.
        if (!onThumbnailReady || capturedUrlRef.current === glbUrl) return;
        const targetUrl = glbUrl;
        requestAnimationFrame(() => {
          const liveCtx = sceneCtxRef.current;
          if (!liveCtx) return;
          if (capturedUrlRef.current === targetUrl) return;
          if (modelRef.current === null) return;
          liveCtx.controls.update();
          liveCtx.renderer.render(liveCtx.scene, liveCtx.camera);
          liveCtx.renderer.domElement.toBlob((blob) => {
            if (!blob) return;
            // Mark captured before invoking the handler so a synchronous
            // store update that re-renders this component can't loop.
            capturedUrlRef.current = targetUrl;
            onThumbnailReady(blob);
          }, "image/png");
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });
  }, [glbUrl, onThumbnailReady]);

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
