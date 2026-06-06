import { type ReactNode, useEffect, useRef } from "react";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";

interface NoiseReductionBrainProps {
  /**
   * Forwarded to the wrapping element so the brain can be positioned/clipped
   * to fill its host (the inset `.nrScreen` well), matching the static
   * `.nrScreenImage` it overlays.
   */
  className?: string;
}

/** Source angiography used as the vessel luminance mask. */
const BRAIN_SRC = "/noise-reduction-brain.png";

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

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
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
 * Animated WebGL2 brain for the NoiseReductionCard "screen" (the spec bento
 * below "Expertise without ego." on `/agents`). Samples the existing
 * `/noise-reduction-brain.png` angiography as a vessel mask and animates it:
 * energy pulses travel along the vessels, the brain breathes, and the color
 * drifts through the reference palette. Blends over the black glass via
 * premultiplied-off alpha so the screen shows through the empty space.
 *
 * Falls back to a no-op when WebGL2 is unavailable (e.g. JSDOM in tests, or
 * unsupported browsers) or the image fails to load, leaving the static
 * `.nrScreenImage` beneath it visible.
 */
export function NoiseReductionBrain({
  className,
}: NoiseReductionBrainProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const program = createProgram(gl);
    if (!program) return;

    // No VAO/attributes needed — the vertex shader synthesizes a
    // full-screen triangle from `gl_VertexID`. A bound empty VAO keeps
    // the draw call valid in core WebGL2.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Blend the transparent background of the brain over the screen's glass.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const texResolutionLoc = gl.getUniformLocation(program, "u_texResolution");
    const timeLoc = gl.getUniformLocation(program, "u_time");
    const texLoc = gl.getUniformLocation(program, "u_tex");

    // Texture for the brain angiography. Seed with a 1x1 transparent pixel
    // so the program is renderable before the image finishes loading.
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let imageLoaded = false;
    let texWidth = 1;
    let texHeight = 1;

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      texWidth = image.naturalWidth || 1;
      texHeight = image.naturalHeight || 1;
      imageLoaded = true;
    };
    image.src = BRAIN_SRC;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };
    resize();

    // The RAF loop repaints every frame, so a resize is picked up on the
    // next tick; no explicit redraw needed here.
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const start = performance.now();
    let rafId: number | null = null;

    const draw = (timeSeconds: number) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Hold off drawing the brain until its texture is uploaded so we never
      // flash the seed pixel; the static fallback img shows through until then.
      if (!imageLoaded) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(texLoc, 0);
      gl.uniform2f(resolutionLoc, width, height);
      gl.uniform2f(texResolutionLoc, texWidth, texHeight);
      gl.uniform1f(timeLoc, timeSeconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const renderLoop = (now: number) => {
      draw((now - start) / 1000);
      rafId = requestAnimationFrame(renderLoop);
    };

    // Always animate: this is an ambient, living readout, so we keep it
    // looping rather than freezing to a single static frame.
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      image.onload = null;
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div className={className} aria-hidden="true">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
