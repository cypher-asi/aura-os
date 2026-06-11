/*
 * ScreenOrbBackground — a full-screen animated page background that paints
 * the SAME flowing plasma as the `/agents` "Delegate everything" hero orb
 * (`AuraScreenOrb`, `variant="screen"`): a domain-warped, marbled noise
 * field cycling through the warm orange -> coral -> mauve -> lavender
 * reference palette with travelling bright ridges.
 *
 * The marketing `AuraScreenOrb` is purpose-built for the device's pill-
 * shaped screen — it feathers its alpha to transparent and darkens toward
 * a stadium-shaped vignette so it tucks into the black glass bezel. That
 * makes it read as a rounded pill when stretched across the whole page.
 * This component keeps the identical fbm/palette/ridge math but renders it
 * OPAQUE and EDGE-TO-EDGE (only a gentle rectangular vignette), so on the
 * public landing it fills the full viewport exactly like the Vibecoder
 * `FlowFieldBackground` purple field — same canvas element, same sizing,
 * same lifecycle.
 *
 * Used for personas whose theme sets `siteBackgroundOrb: true`.
 *
 * Performance posture mirrors `FlowFieldBackground`:
 *   - One fullscreen quad + one fragment shader (no geometry churn).
 *   - Device pixel ratio capped at 1.5.
 *   - rAF loop pauses while the tab is hidden.
 *   - `prefers-reduced-motion: reduce` slows (does not freeze) the drift.
 *   - Bails out cleanly (renders an empty canvas) when WebGL is
 *     unavailable so the wrapper's solid `siteBackgroundColor` shows.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import styles from "./PublicChatView.module.css";

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

// Ported 1:1 from `AuraScreenOrb`'s SCREEN_FRAGMENT_SHADER (the
// "Delegate everything" orb), with the pill SDF vignette + alpha
// feather replaced by an opaque, full-bleed output plus a soft
// rectangular vignette so it covers the whole page edge-to-edge.
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  vec3 palette(float v) {
    vec3 cA = vec3(0.98, 0.46, 0.14);  // warm orange
    vec3 cB = vec3(1.00, 0.50, 0.40);  // coral / salmon
    vec3 cC = vec3(0.80, 0.56, 0.66);  // dusty mauve
    vec3 cD = vec3(0.66, 0.71, 0.94);  // soft lavender / periwinkle
    vec3 cHot = vec3(1.00, 0.93, 0.82); // near-white crest

    vec3 col = mix(cA, cB, smoothstep(0.0, 0.35, v));
    col = mix(col, cC, smoothstep(0.30, 0.62, v));
    col = mix(col, cD, smoothstep(0.58, 0.86, v));
    col = mix(col, cHot, smoothstep(0.86, 1.0, v));
    return col;
  }

  void main() {
    // Aspect-correct, y-normalized coordinates centered on the screen.
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
    float t = uTime;

    // Domain warping: fold the coordinate space through layers of flowing
    // noise so the pattern marbles and churns across the field.
    vec2 p = uv * 2.3;

    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + vec2(t * 0.12, t * 0.05)),
      fbm(p + vec2(5.2, 1.3) + vec2(-t * 0.10, t * 0.08))
    );

    vec2 s = vec2(
      fbm(p + 3.5 * q + vec2(1.7, 9.2) + vec2(t * 0.06, -t * 0.09)),
      fbm(p + 3.5 * q + vec2(8.3, 2.8) - vec2(t * 0.07, t * 0.04))
    );

    float flow = fbm(p + 4.0 * s + vec2(-t * 0.05, t * 0.03));

    float v = clamp(flow * 1.35 + 0.12 * sin(t * 0.4), 0.0, 1.0);
    vec3 col = palette(v);

    // Glowing ridges: bright filaments where the warped layers stack up,
    // pulsing on their own slow beat so highlights travel through the
    // pattern like thought moving through it.
    float ridge = pow(clamp(dot(q, s) + 0.5, 0.0, 1.0), 1.8);
    float pulse = 0.6 + 0.4 * sin(t * 1.2 + flow * 6.2831);
    col += vec3(1.0, 0.85, 0.7) * ridge * 0.45 * pulse;

    // Gentle overall luminance lift so the pattern reads as emissive,
    // modulated by the flow so it shimmers as it moves.
    col *= 0.78 + 0.55 * flow + 0.18 * pulse;

    // Soft rectangular vignette to settle the edges — full-bleed and
    // opaque (no pill mask, no alpha feather) so the field fills the
    // whole viewport exactly like the Vibecoder purple background.
    vec2 uvn = gl_FragCoord.xy / uResolution;
    float vig = smoothstep(1.25, 0.35, distance(uvn, vec2(0.5)));
    col *= mix(0.82, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function ScreenOrbBackground(): React.ReactElement | null {
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

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={styles.siteBackgroundCanvas}
      aria-hidden="true"
      data-testid="public-chat-site-bg-orb"
    />
  );
}
