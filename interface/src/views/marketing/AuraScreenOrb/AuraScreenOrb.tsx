import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  observeSceneActivity,
  prefersReducedMotion,
} from "../scene-activity";
import {
  RADIAL_FRAGMENT_SHADER,
  SCREEN_FRAGMENT_SHADER,
  VERTEX_SHADER,
} from "./shaders";

/*
 * The plasma is intrinsically soft (domain-warped fbm), so it survives
 * being rendered below CSS resolution and upscaled by the browser with no
 * visible quality loss. 0.75 linear scale ≈ 44% fewer fragments; combined
 * with the 1.5 DPR cap that's roughly a third of the old (2.0 DPR) cost.
 */
const RESOLUTION_SCALE = 0.75;
const MAX_DPR = 1.5;

/**
 * Which fragment shader the orb paints:
 *   - "screen" (default): the domain-warped marbled plasma used on the
 *     large AgentConsole device pill.
 *   - "radial": coarse, polar bands flowing outward from the center with
 *     a glowing inset rim — tuned for the tiny circular "+" attach well
 *     on the marketing mock LLM input, where the fine "screen" detail is
 *     illegible.
 */
type AuraScreenOrbVariant = "screen" | "radial";

interface AuraScreenOrbProps {
  /**
   * Forwarded to the wrapping element so the orb can be positioned/clipped
   * to fill its host (the circular `<DeviceScreen />` well).
   */
  className?: string;
  /** Selects the fragment shader. Defaults to "screen". */
  variant?: AuraScreenOrbVariant;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  fragmentSource: string,
): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // Shader objects can be detached/deleted once linked into the program.
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Procedural WebGL2 energy field for the AgentConsole device's top
 * circular screen, replacing the old static text readout. Draws a
 * full-screen fragment shader (a breathing hot core, drifting plasma,
 * and wandering bright nuclei fading into a lavender halo) in a
 * `requestAnimationFrame` loop so the screen reads as a living, thinking
 * AGI. Falls back to a no-op when WebGL2 is unavailable (e.g. JSDOM in
 * tests, or unsupported browsers), letting the black glass well show
 * through.
 */
export function AuraScreenOrb({
  className,
  variant = "screen",
}: AuraScreenOrbProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Drives the entrance fade: stays false until the WebGL context is up
  // and the first frame has actually been painted, so the orb fades in
  // smoothly when ready instead of popping in as an empty/black canvas.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // No MSAA: the scene is a single full-screen triangle (no geometry
    // edges to antialias), so requesting it only wastes memory/bandwidth.
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const fragmentSource =
      variant === "radial" ? RADIAL_FRAGMENT_SHADER : SCREEN_FRAGMENT_SHADER;
    const program = createProgram(gl, fragmentSource);
    if (!program) return;

    // No VAO/attributes needed — the vertex shader synthesizes a
    // full-screen triangle from `gl_VertexID`. A bound empty VAO keeps
    // the draw call valid in core WebGL2.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Blend the transparent rim of the field over the screen's glass.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const timeLoc = gl.getUniformLocation(program, "u_time");

    let width = 0;
    let height = 0;
    let alive = true;
    const resize = () => {
      const dpr =
        Math.min(window.devicePixelRatio || 1, MAX_DPR) * RESOLUTION_SCALE;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      // Resizing the drawing buffer clears it, and ResizeObserver fires
      // after rAF but before paint, so repaint synchronously here —
      // otherwise the cleared buffer is composited for a frame (flicker)
      // while the loop runs, or a stale stretched frame shows while stopped.
      if (painted) drawNow();
    };

    const start = performance.now();
    let rafId: number | null = null;
    let painted = false;

    const draw = (timeSeconds: number) => {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(resolutionLoc, width, height);
      gl.uniform1f(timeLoc, timeSeconds);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!painted) {
        painted = true;
        // Reveal the orb only after the first real frame is on screen.
        setReady(true);
      }
    };

    const drawNow = () => draw((performance.now() - start) / 1000);

    const renderLoop = (now: number) => {
      draw((now - start) / 1000);
      rafId = requestAnimationFrame(renderLoop);
    };

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const reducedMotion = prefersReducedMotion();

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Animate only while the orb is actually visible (near the viewport
    // AND the tab is shown); under reduced motion hold a single painted
    // frame instead of looping.
    const detachActivity = observeSceneActivity(canvas, (active) => {
      if (!alive) return;
      if (!active) {
        stopLoop();
        return;
      }
      if (reducedMotion) {
        drawNow();
        return;
      }
      if (rafId === null) rafId = requestAnimationFrame(renderLoop);
    });

    return () => {
      alive = false;
      detachActivity();
      stopLoop();
      observer.disconnect();
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      // Re-arm the entrance fade if the effect re-runs (e.g. variant change).
      setReady(false);
    };
  }, [variant]);

  return (
    <div className={className} aria-hidden="true">
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          opacity: ready ? 1 : 0,
          transition: "opacity 600ms ease-out",
        }}
      />
    </div>
  );
}
