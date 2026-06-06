import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";

interface NoiseReductionBrainProps {
  /**
   * Forwarded to the wrapping element so the brain can be positioned/clipped
   * to fill its host (the inset `.nrScreen` well), matching the static
   * `.nrScreenImage` it overlays.
   */
  className?: string;
  /**
   * Normalized (0..1) cursor position over the screen, updated by the host
   * card on `pointermove`. Read every frame (never triggers a re-render) and
   * eased into the `u_mouse` uniform so the cursor steers the animation. When
   * omitted, the brain animates around screen center (0.5, 0.5).
   */
  pointerRef?: RefObject<{ x: number; y: number }>;
}

/** Source angiography used as the vessel luminance mask. */
const BRAIN_SRC = "/noise-reduction-brain.png";

/**
 * Lines of code + mathematics drawn into the offscreen glyph texture that
 * backs the brain's LEFT (analytical) hemisphere. Kept terse and monospace
 * so they tile into a faint "matrix readout" behind the mono vessels.
 */
const CODE_LINES = [
  "for (let i = 0; i < n; i++)",
  "const grad = ∇f(x);",
  "∑ wᵢ·xᵢ + b",
  "P(A|B) = P(B|A)P(A)/P(B)",
  "λ = eig(A);",
  "∫ f(x) dx = F(b) − F(a)",
  "return softmax(logits);",
  "θ ← θ − η·∇L(θ)",
  "if (x ≡ y mod p) {",
  "matrix M[i][j] = Σ aᵢ·bⱼ",
  "lim x→∞  1/x = 0",
  "assert(isPrime(n));",
  "dy/dx = cos(x²)·2x",
  "while (!converged) {",
  "O(n log n)",
  "x = (-b ± √(b²−4ac)) / 2a",
];

/**
 * Render the code/math lines to an offscreen canvas (white on transparent)
 * for use as a tiling WebGL texture. Returns null when 2D canvas is
 * unavailable (e.g. JSDOM), in which case the left backdrop is simply empty.
 */
function createCodeCanvas(): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  const size = 512;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.font =
    '15px "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace';

  const lineHeight = size / CODE_LINES.length;
  CODE_LINES.forEach((line, i) => {
    // Stagger the indent so the columns don't read as a rigid grid.
    const indent = 6 + (i % 4) * 14;
    ctx.fillText(line, indent, i * lineHeight + (lineHeight - 15) / 2);
  });

  return canvas;
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
 * Animated WebGL2 SPLIT brain for the NoiseReductionCard "screen" (the spec
 * bento below "Expertise without ego. ... from coding to science to
 * creativity." on `/agents`). Samples the existing
 * `/noise-reduction-brain.png` angiography as a vessel mask, then splits it
 * down the midline: the LEFT hemisphere renders as black-and-white code and
 * mathematics over monochrome ink vessels (the analytical side), while the
 * RIGHT hemisphere drifts through a saturated, abstract paint-splatter
 * palette (the creative side). Energy pulses travel along the vessels and
 * the whole brain breathes. Blends over the black glass via
 * premultiplied-off alpha so the screen shows through the empty space.
 *
 * Falls back to a no-op when WebGL2 is unavailable (e.g. JSDOM in tests, or
 * unsupported browsers) or the image fails to load, leaving the static
 * `.nrScreenImage` beneath it visible.
 */
export function NoiseReductionBrain({
  className,
  pointerRef,
}: NoiseReductionBrainProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stable ref to the latest pointer prop so the one-shot render loop can read
  // the current cursor position without re-subscribing each move.
  const pointerSource = useRef(pointerRef);
  pointerSource.current = pointerRef;

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
    const mouseLoc = gl.getUniformLocation(program, "u_mouse");
    const texLoc = gl.getUniformLocation(program, "u_tex");
    const codeLoc = gl.getUniformLocation(program, "u_code");
    const codeResolutionLoc = gl.getUniformLocation(
      program,
      "u_codeResolution",
    );

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

    // Code/math glyph texture for the left hemisphere backdrop. Drawn once to
    // an offscreen 2D canvas; tiled + scrolled in the shader. WRAP set to
    // REPEAT so `fract(uv)` sampling tiles seamlessly. Falls back to a 1x1
    // transparent texture when 2D canvas is unavailable.
    const codeCanvas = createCodeCanvas();
    let codeWidth = 1;
    let codeHeight = 1;
    const codeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, codeTexture);
    if (codeCanvas) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        codeCanvas,
      );
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      codeWidth = codeCanvas.width;
      codeHeight = codeCanvas.height;
    } else {
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
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
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

    // Eased cursor position fed to the shader. We lerp toward the host's
    // pointer ref each frame so the animation tracks the mouse smoothly
    // rather than snapping. Y is flipped at upload time to match the
    // shader's bottom-origin screen UVs.
    let mouseX = 0.5;
    let mouseY = 0.5;

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
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, codeTexture);
      gl.uniform1i(codeLoc, 1);
      const target = pointerSource.current?.current;
      const tx = target ? target.x : 0.5;
      const ty = target ? target.y : 0.5;
      mouseX += (tx - mouseX) * 0.12;
      mouseY += (ty - mouseY) * 0.12;
      gl.uniform2f(resolutionLoc, width, height);
      gl.uniform2f(texResolutionLoc, texWidth, texHeight);
      gl.uniform2f(codeResolutionLoc, codeWidth, codeHeight);
      gl.uniform1f(timeLoc, timeSeconds);
      gl.uniform2f(mouseLoc, mouseX, 1.0 - mouseY);
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
      gl.deleteTexture(codeTexture);
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
