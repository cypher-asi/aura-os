/*
 * FlowFieldBackground — a subtle, performant animated page background
 * painted with a single fullscreen WebGL fragment shader.
 *
 * Used on the public landing (`PublicChatView`) for personas whose
 * theme sets `siteBackgroundFlow: true` (currently only Vibecoder). It
 * renders a slowly-drifting, domain-warped fbm noise field tinted by
 * the persona's `baseColor`, replacing the static `site.png` for that
 * persona while every other persona keeps its image untouched.
 *
 * Performance posture:
 *   - One fullscreen quad + one fragment shader (no geometry churn).
 *   - Device pixel ratio capped at 1.5.
 *   - rAF loop pauses while the tab is hidden.
 *   - `prefers-reduced-motion: reduce` renders a single static frame.
 *   - Bails out cleanly (renders nothing) when WebGL is unavailable so
 *     the wrapper's solid `siteBackgroundColor` (and any `<img>`
 *     fallback) remains visible.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import styles from "./PublicChatView.module.css";

interface FlowFieldBackgroundProps {
  /** Hex base tint (e.g. "#2a0258"); the field is built around this. */
  readonly baseColor: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int) || full.length !== 6) return [0.16, 0.01, 0.35];
  return [
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  ];
}

function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

const VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Domain-warped fbm over Ashima 2D simplex noise, mapped onto a
// palette built from the base tint (darker trough -> brighter ridge)
// with a faint cool/warm hue shift along the flow for depth.
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uColor;

  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
           + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fewer octaves => smoother, larger-scale shapes (less busy detail).
  float fbm(vec2 p){
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      v += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    // Lower frequency => much larger, gentler blobs.
    vec2 p = vec2(uv.x * aspect, uv.y) * 0.7;

    // Clearly perceptible (but still slow) drift.
    float t = uTime * 0.22;

    // Two-stage domain warp for organic, flowing motion.
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.20 * t)),
      fbm(p + vec2(5.2, 1.3 - 0.20 * t))
    );
    vec2 r = vec2(
      fbm(p + 1.2 * q + vec2(1.7, 9.2) + 0.30 * t),
      fbm(p + 1.2 * q + vec2(8.3, 2.8) - 0.26 * t)
    );
    float f = fbm(p + 1.2 * r);

    float n = clamp(f * 0.5 + 0.5, 0.0, 1.0);

    // Palette from the base tint: a gentle trough-to-ridge ramp with a
    // faint hue lift so the field reads as soft moving light over the
    // persona color. Low contrast keeps the pattern subtle.
    vec3 base = uColor;
    vec3 dark = base * 0.82;
    vec3 bright = clamp(base * 1.32 + vec3(0.05, 0.01, 0.09), 0.0, 1.0);

    vec3 col = mix(dark, base, smoothstep(0.0, 0.65, n));
    col = mix(col, bright, smoothstep(0.55, 1.0, n) * 0.7);

    // Gentle radial vignette to settle the edges.
    float vig = smoothstep(1.3, 0.4, distance(uv, vec2(0.5)));
    col *= mix(0.9, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function FlowFieldBackground({
  baseColor,
}: FlowFieldBackgroundProps): React.ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isWebGLAvailable()) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);

    const [r, g, b] = hexToRgb(baseColor);
    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(r, g, b) },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const resize = (): void => {
      const w = Math.max(parent.clientWidth, 1);
      const h = Math.max(parent.clientHeight, 1);
      renderer.setSize(w, h, false);
      const buf = new THREE.Vector2();
      renderer.getDrawingBufferSize(buf);
      uniforms.uResolution.value.set(buf.x, buf.y);
    };
    resize();

    // Honor reduced-motion by slowing the drift rather than freezing it
    // entirely — the field is a decorative, low-contrast wash and a dead-
    // still frame reads as "broken" (some embedded webviews also report
    // reduce by default, which previously froze the bg outright).
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const speed = reducedMotion ? 0.4 : 1;

    let raf = 0;
    let lastTime = performance.now();

    const renderFrame = (): void => {
      renderer.render(scene, camera);
    };

    const loop = (now: number): void => {
      // Accumulate only elapsed time so pausing on a hidden tab does
      // not snap the animation forward when it resumes.
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      uniforms.uTime.value += dt * speed;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };

    const start = (): void => {
      if (raf) return;
      lastTime = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = (): void => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      // Repaint synchronously: resizing the drawing buffer clears it, and
      // ResizeObserver fires after rAF but before paint, so without an
      // immediate redraw the cleared (black) buffer gets composited for a
      // frame — a visible flicker on every resize step.
      renderFrame();
    });
    resizeObserver.observe(parent);
    document.addEventListener("visibilitychange", onVisibility);

    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [baseColor]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.siteBackgroundCanvas}
      aria-hidden="true"
      data-testid="public-chat-site-bg-flow"
    />
  );
}
