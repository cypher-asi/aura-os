import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SCREEN_FRAGMENT_SHADER } from "../AuraScreenOrb/shaders";
import { createProviderLogoTextures } from "./provider-logo-textures";

/**
 * The three computers in the stack, top to bottom: the upper ghost
 * wireframe, the solid middle device, and the lower ghost wireframe.
 */
export type DeviceTier = "top" | "middle" | "bottom";

export interface IsolatedDeviceSceneOptions {
  /**
   * Fires when the pointer moves onto a different computer in the stack
   * (or off the canvas entirely, reported as `null`).
   */
  onHoverChange?: (tier: DeviceTier | null) => void;
}

export interface IsolatedDeviceScene {
  dispose(): void;
}

export function isWebGLAvailable(): boolean {
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

/*
 * Device geometry, in world units (footprint side = 2). Shaped after the
 * reference render: a squircle-footprint case with a rounded-over lid edge
 * and a recessed screen in the lid opening, all sitting on a slightly inset
 * base plinth. Vertical layout (y-up):
 *
 *   0.00 .. 0.14   base plinth (inset)
 *   0.12 .. 0.555  case band (full footprint, louver banks + LED strip)
 *   0.545 .. 0.655 lid (bevelled ring with the recessed screen inside)
 */
const SIZE = 2;
const CORNER_R = 0.4;

const BASE_SILHOUETTE = 1.86;
const BASE_BEVEL = 0.015;
const BASE_DEPTH = 0.11; // + 2 * bevel = 0.14 tall
const BASE_Y = 0.015;

const CASE_BOTTOM = 0.12;
const CASE_TOP = 0.555;

const LID_BEVEL = 0.03;
const LID_DEPTH = 0.05; // + 2 * bevel = 0.11 tall
const LID_Y = 0.575; // bottom bevel tucks to 0.545; top face lands at 0.655

/** Rounded-square opening cut through the lid ring (shape-local size). */
const HOLE_SIZE = 1.46;
const HOLE_R = 0.26;

/**
 * Recessed screen panel (square; edges hide under the lid ring). The lid
 * opening is widest at mid-depth (the extrude bevel flares the 1.46 hole to
 * ~1.52 there), so the plane overshoots that flare — otherwise a sliver of
 * the dark case shows past the plane's edge at the opening corners.
 */
const ORB_PLANE_SIZE = 1.56;
const ORB_PLANE_Y = 0.59;

/** Louver bank planes on the case walls, tucked toward the far wall ends. */
const VENT_W = 0.48;
const VENT_H = 0.22;
const VENT_CENTER = -0.34; // along the wall, clear of the corner rounding
const VENT_Y = 0.3; // sits low in the case band, leaving room for the LEDs

/**
 * Status LED strip: a row of small amber dots on the front-left wall, above
 * the louver bank, that "beep" in a chasing sequence. Each dot gets its own
 * emissive material so the chase can drive intensities per dot.
 */
const LED_COUNT = 6;
const LED_RADIUS = 0.016;
const LED_SPACING = 0.066;
const LED_START_X = -0.56; // strip start, aligned over the vent's left edge
const LED_Y = 0.48;

/**
 * Etched wall lines (sides only, after the reference): a thin continuous
 * seam groove running just under the lid across each visible wall's flat
 * region, and a vertical dashed groove near each wall's near-corner end.
 */
const ETCH_SEAM_W = 1.2; // spans the wall's flat region between corners
const ETCH_SEAM_H = 0.02;
const ETCH_SEAM_Y = 0.515;
const ETCH_DASH_W = 0.02;
const ETCH_DASH_H = 0.34;
const ETCH_DASH_Y = 0.33;
const ETCH_DASH_POS = 0.55; // along the wall, just before the corner curve

/**
 * Ghost stack: simplified gray-outline copies of the computer above and
 * below the real one, joined by four dashed columns at the footprint
 * corners that stream downward — the "instances dropping through the
 * pipeline" composition from the reference. `DASH_COLUMN` sits just outside
 * the body's rounded corners so the columns pass the solid device instead
 * of clipping through its walls.
 */
const DEVICE_H = 0.655;
const GHOST_ABOVE_Y = 2.33; // group origin (body bottom) of the upper ghost
const GHOST_BELOW_Y = -2.33; // group origin of the lower ghost
const GHOST_CORNER = 0.882; // |x|=|z| of the rounded-corner verticals
/**
 * Dash columns connect the devices ONLY across the gaps between them: an
 * upper run from the main computer's top surface into the bottom of the
 * upper ghost, and a lower run from the lower ghost's top into the main
 * computer's underside. They stand on the lid ring (inside the footprint),
 * so they read as rooted in the top plate: the middle column by the near
 * corner, and each side column on a side corner's diagonal, centered
 * between the screen-recess corner line and the outer corner vertical.
 */
const DASH_INSET = 0.7; // |x|=|z| of the middle column on the lid ring
/** |x|=|z| of the screen-recess (hole) outline's rounded-corner point. */
const HOLE_CORNER = HOLE_SIZE / 2 - HOLE_R + HOLE_R / Math.SQRT2;
/**
 * |x|=|z| of each side dash column, midway between the screen recess's
 * corner and the silhouette corner: on screen each side column reads as
 * centered between the stack's inner (screen-corner) line and its outer
 * corner vertical.
 */
const DASH_SIDE = (GHOST_CORNER + HOLE_CORNER) / 2;
const DASH_LEN = 0.06;
const DASH_PERIOD = 0.12; // dash + gap
const DASH_SPEED = 0.35; // world units per second, downward

/**
 * Provider-logo quadrant on the upper ghost's top plate: four flat decals
 * arranged 2x2 inside the screen-recess area, each rotating through the
 * model-provider marks. Per quadrant the cycle is fade in -> hold -> fade
 * out -> hidden gap (where the mark swaps to the next provider), with the
 * four quadrants staggered a quarter-cycle apart so requests read as
 * continuously streaming through different providers.
 */
const LOGO_QUAD_OFFSET = 0.31; // |x|=|z| of each quadrant center
const LOGO_QUAD_SIZE = 0.3; // side of each square decal plane
const LOGO_CYCLE_S = 4.8; // full per-quadrant cycle length
const LOGO_VISIBLE_S = 3.4; // visible portion (fades included); rest is gap
const LOGO_FADE_S = 0.7; // fade-in / fade-out ramp within the visible span
const LOGO_MAX_OPACITY = 0.5; // matches the wireframe's mid tier
const LOGO_DRIFT = 0.05; // total upward drift across a visibility span

/**
 * Hover glow: a soft white additive halo sprite fades in while a computer
 * is hovered, plus the hovered ghost's wireframe lines brighten. The ghost
 * halos sit centered behind their wireframes; the solid middle device's
 * halo is dropped below its base instead (its materials stay untouched),
 * so the glow reads as light spilling out from under the computer. The
 * fade is an exponential approach (per-frame lerp) so the glow eases
 * in/out instead of popping.
 */
const GLOW_CENTER_Y = DEVICE_H / 2;
const GLOW_MIDDLE_Y = -0.35; // middle halo center, tucked under the base
const GLOW_SCALE_X = 3.6;
const GLOW_SCALE_Y = 1.9;
const GLOW_MAX_OPACITY = 0.16;
const GLOW_FADE_RATE = 9; // 1/s exponential approach toward the target
const GHOST_HOVER_BOOST = 0.45; // extra line-opacity multiplier at full glow

const DEVICE_TIERS: readonly DeviceTier[] = ["top", "middle", "bottom"];

/**
 * Pose: the near vertical corner points exactly at the camera (a perfect
 * diamond silhouette), angled forward so the walls read alongside the top
 * plate, with the near bottom corner staying centered. The pose is fixed —
 * no sway or pointer tilt — so the diamond stays perfectly centered and
 * symmetric. The camera is ORTHOGRAPHIC: no perspective foreshortening, so
 * every computer in the stack projects at exactly the same width/height and
 * the composition sits flat on the page like the rest of the site's
 * isometric artwork.
 */
const BASE_YAW = -Math.PI / 4;
const CAMERA_ELEVATION_DEG = 30;
const CAMERA_TARGET_Y = 0.33; // midpoint of the ghost stack
const CAMERA_DISTANCE = 10;
/** Ortho frustum width: the diamond footprint plus a small margin. */
const CAMERA_VIEW_W = SIZE * Math.SQRT2 * 1.12;

const ORB_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The first section's console-screen shader (the AgentConsole's marbled
 * plasma field, see `../AuraScreenOrb/shaders.ts`), retargeted from a
 * full-screen WebGL2 pass to a three.js GLSL1 `ShaderMaterial` on the panel
 * screen plane: the `#version` line and explicit output declaration are
 * swapped for three's GLSL1 conventions, and both screen-space coordinate
 * setups (the flow field's and the vignette's) become plane UVs against a
 * fixed virtual resolution. The vignette's rounded-box radius is widened to
 * follow the screen panel's rounded-square silhouette instead of the console
 * pill. Sharing the source string keeps the device's screen in lockstep
 * with the first section's animation.
 */
const ORB_PANEL_FRAGMENT_SHADER = SCREEN_FRAGMENT_SHADER.replace(
  "#version 300 es",
  "",
)
  .replace("out vec4 fragColor;", "varying vec2 vUv;")
  .replace("fragColor =", "gl_FragColor =")
  .replace(
    "vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;",
    "vec2 uv = vUv - 0.5;",
  )
  .replace(
    "vec2 fragP = gl_FragCoord.xy - 0.5 * u_resolution;",
    "vec2 fragP = (vUv - 0.5) * u_resolution;",
  )
  .replace(
    "float radius = min(halfRes.x, halfRes.y);",
    "float radius = 0.36 * min(halfRes.x, halfRes.y);",
  );

/** Virtual pixel resolution fed to the vignette math on the panel plane. */
const ORB_PANEL_VIRTUAL_RES = 512;

/**
 * View-space depth (z toward the camera, after `BASE_YAW`) of a footprint
 * shape's near silhouette at a given view-space x. Walks the rotated loop's
 * segments and keeps the largest interpolated z crossing that x. Used to
 * clamp the dash columns where they visually cross the upper ghost's bottom
 * seam: the columns are inset behind that edge, so a dash run ending at the
 * seam's world height would project past the diagonal line on screen.
 */
function nearSilhouetteDepth(shape: THREE.Shape, viewX: number): number {
  const cos = Math.cos(BASE_YAW);
  const sin = Math.sin(BASE_YAW);
  const pts = shape.getPoints(128).map((p) => ({
    x: p.x * cos + p.y * sin,
    z: -p.x * sin + p.y * cos,
  }));
  let best = -Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (viewX < lo || viewX > hi || hi - lo < 1e-6) continue;
    const t = (viewX - a.x) / (b.x - a.x);
    best = Math.max(best, a.z + t * (b.z - a.z));
  }
  return best;
}

/** Closed polyline loop of a footprint shape at a given height (y-up). */
function outlineLoop(shape: THREE.Shape, y: number): THREE.BufferGeometry {
  const pts = shape.getPoints(64).map((p) => new THREE.Vector3(p.x, y, p.y));
  pts.push(pts[0].clone());
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/**
 * Camera-facing half of a footprint loop at a given height: only the points
 * on the near side of the +x/+z viewing diagonal, i.e. poor-man's
 * hidden-line removal. Body seams drawn with this read like seams on the
 * solid device's visible walls — full loops would also draw their far arcs,
 * which stack up on screen and make the wireframe body look much taller
 * than the real computer.
 */
function nearArc(shape: THREE.Shape, y: number): THREE.BufferGeometry {
  const pts2 = shape.getPoints(64);
  // Rotate the loop so it starts at the farthest point from the camera,
  // making the kept near-side run contiguous.
  let farIndex = 0;
  let farValue = Infinity;
  pts2.forEach((p, i) => {
    const v = p.x + p.y;
    if (v < farValue) {
      farValue = v;
      farIndex = i;
    }
  });
  const rotated = [...pts2.slice(farIndex), ...pts2.slice(0, farIndex)];
  const pts = rotated
    .filter((p) => p.x + p.y >= -0.001)
    .map((p) => new THREE.Vector3(p.x, y, p.y));
  // Snap the run's ends onto the exact silhouette corner points (where the
  // corner verticals stand), so the arc meets them cleanly — the discrete
  // loop sampling otherwise leaves a small gap or a crossing stub.
  const west = new THREE.Vector3(-GHOST_CORNER, y, GHOST_CORNER);
  const east = new THREE.Vector3(GHOST_CORNER, y, -GHOST_CORNER);
  const first = pts[0];
  if (first.distanceTo(west) < first.distanceTo(east)) {
    pts.unshift(west);
    pts.push(east);
  } else {
    pts.unshift(east);
    pts.push(west);
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Rounded square centered on the origin (the device's squircle footprint). */
function roundedSquare(size: number, radius: number): THREE.Shape {
  const h = size / 2;
  const r = radius;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(h, h - r);
  s.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-h + r, h);
  s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-h, -h + r);
  s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Extrude a footprint shape into a y-up slab. ExtrudeGeometry's bevel grows
 * the silhouette outward by `bevel` at mid-depth and rounds both rims, which
 * is exactly the rounded-over edge treatment the reference case has — callers
 * size their shapes `bevel` smaller per side to hit the target silhouette.
 */
function extrudeSlab(
  shape: THREE.Shape,
  depth: number,
  bevel: number,
): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 48,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Subtle brushed-metal texture: soft low-frequency streaks on a solid base,
 * kept low-contrast and blurred so it reads as a machined finish rather than
 * noise (env-map reflections would amplify speckle).
 */
function createBrushedTexture(base: string, streak: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.filter = "blur(1.5px)";
    ctx.strokeStyle = streak;
    ctx.lineCap = "round";
    for (let i = 0; i < 140; i += 1) {
      const x = Math.random() * size;
      ctx.globalAlpha = 0.012 + Math.random() * 0.022;
      ctx.lineWidth = 1 + Math.random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.bezierCurveTo(
        x + (Math.random() * 16 - 8),
        size * 0.33,
        x + (Math.random() * 16 - 8),
        size * 0.66,
        x + (Math.random() * 16 - 8),
        size + 10,
      );
      ctx.stroke();
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Louvered vent decal (transparent canvas): a bank of thin dark slats, each
 * with a faint light lip on its leading edge, matching the drilled intake
 * banks on the reference case walls.
 */
function createVentTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const slats = 11;
    const pitch = w / slats;
    const slatW = pitch * 0.46;
    for (let i = 0; i < slats; i += 1) {
      const x = i * pitch + (pitch - slatW) / 2;
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.beginPath();
      ctx.roundRect(x - 3, 8, slatW, h - 16, slatW / 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
      ctx.beginPath();
      ctx.roundRect(x, 8, slatW, h - 16, slatW / 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Etched groove decal (transparent canvas): a thin dark line with a faint
 * light lip beneath it, so it reads as a recess milled into the wall.
 * `dashed` breaks the line into short segments like the reference's etched
 * tick lines; otherwise it draws one continuous seam.
 */
function createEtchTexture(dashed: boolean): THREE.CanvasTexture {
  const w = 512;
  const h = 16;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const dash = 30;
    const gap = 18;
    const step = dashed ? dash + gap : w;
    const len = dashed ? dash : w;
    for (let x = 0; x < w; x += step) {
      const segment = Math.min(len, w - x);
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.beginPath();
      ctx.roundRect(x, 5, segment, 4, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
      ctx.beginPath();
      ctx.roundRect(x, 9, segment, 2, 1);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Soft radial hover-glow decal (transparent canvas): a cool white falloff
 * rendered as an additive sprite behind (or under) the hovered computer.
 */
function createGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0, "rgba(240, 244, 250, 0.85)");
    grad.addColorStop(0.45, "rgba(226, 232, 242, 0.26)");
    grad.addColorStop(1, "rgba(226, 232, 242, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * WebGL "isolated device" scene — a dark matte-metal Mac-mini-style appliance
 * modelled after the reference render, locked in a centered perfect-diamond
 * pose from a high angle. The lid opening holds a recessed screen streaming
 * the first section's console plasma animation. The geometry is static; the
 * motion is the plasma shader plus the status LED strip beeping in sequence,
 * always looping (like the hero console's ambient readout), paused only
 * while the tab is hidden.
 */
export function createIsolatedDeviceScene(
  host: HTMLElement,
  options: IsolatedDeviceSceneOptions = {},
): IsolatedDeviceScene {
  const width = host.clientWidth || 320;
  const height = host.clientHeight || 280;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  // Transparent canvas: the metal card's own gradient shows through behind
  // the device, like the other marketing hardware props.
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  // Environment for the metallic reflections; lights add directional shaping.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;

  // Matte surfaces lean on the lights (not env reflections) for shaping, so
  // the key/fill run a bit hotter than they would for a glossy build.
  const ambient = new THREE.AmbientLight(0x1a2028, 1.1);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2.5, 4, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fa3bf, 0.6);
  fill.position.set(-3, 1.5, -1);
  scene.add(fill);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Dark matte-metal palette, in the same family as the marketing metal cards.
  const caseTexture = createBrushedTexture("#191b1e", "#4a4f56");
  caseTexture.anisotropy = maxAniso;
  const caseMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2d31,
    map: caseTexture,
    metalness: 0.72,
    roughness: 0.68,
    envMapIntensity: 0.55,
  });
  // Recessed screen — the first section's console plasma shader, driven by
  // the same uniform contract as the full-screen original. The shader
  // feathers its own alpha along the rounded-square vignette, so the
  // material blends over the dark case interior beneath.
  const orbUniforms = {
    u_time: { value: 0 },
    u_resolution: {
      value: new THREE.Vector2(ORB_PANEL_VIRTUAL_RES, ORB_PANEL_VIRTUAL_RES),
    },
  };
  const orbMaterial = new THREE.ShaderMaterial({
    vertexShader: ORB_VERTEX_SHADER,
    fragmentShader: ORB_PANEL_FRAGMENT_SHADER,
    uniforms: orbUniforms,
    transparent: true,
  });
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x17181a,
    metalness: 0.6,
    roughness: 0.78,
    envMapIntensity: 0.35,
  });
  const ventTexture = createVentTexture();
  const ventMaterial = new THREE.MeshStandardMaterial({
    map: ventTexture,
    transparent: true,
    metalness: 0.2,
    roughness: 0.9,
    depthWrite: false,
  });
  const etchSeamTexture = createEtchTexture(false);
  const etchSeamMaterial = new THREE.MeshStandardMaterial({
    map: etchSeamTexture,
    transparent: true,
    metalness: 0.2,
    roughness: 0.9,
    depthWrite: false,
  });
  const etchDashTexture = createEtchTexture(true);
  const etchDashMaterial = new THREE.MeshStandardMaterial({
    map: etchDashTexture,
    transparent: true,
    metalness: 0.2,
    roughness: 0.9,
    depthWrite: false,
  });
  const group = new THREE.Group();
  group.rotation.y = BASE_YAW;
  scene.add(group);
  const geometries: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.BufferGeometry>(geo: T): T => {
    geometries.push(geo);
    return geo;
  };

  // Base plinth: a shorter, slightly inset slab under the case.
  const baseGeo = track(
    extrudeSlab(
      roundedSquare(BASE_SILHOUETTE - 2 * BASE_BEVEL, CORNER_R - 0.06),
      BASE_DEPTH,
      BASE_BEVEL,
    ),
  );
  const baseMesh = new THREE.Mesh(baseGeo, baseMaterial);
  baseMesh.position.y = BASE_Y;
  group.add(baseMesh);

  // Case band: the full-footprint wall section between base and lid.
  const caseGeo = track(
    extrudeSlab(roundedSquare(SIZE, CORNER_R), CASE_TOP - CASE_BOTTOM, 0),
  );
  const caseMesh = new THREE.Mesh(caseGeo, caseMaterial);
  caseMesh.position.y = CASE_BOTTOM;
  group.add(caseMesh);

  // Lid: a beveled ring (the rounded-over edge) with the screen opening cut
  // through it; the bevel also chamfers into the recess.
  const lidShape = roundedSquare(SIZE - 2 * LID_BEVEL, CORNER_R - LID_BEVEL);
  lidShape.holes.push(roundedSquare(HOLE_SIZE, HOLE_R));
  const lidGeo = track(extrudeSlab(lidShape, LID_DEPTH, LID_BEVEL));
  const lidMesh = new THREE.Mesh(lidGeo, caseMaterial);
  lidMesh.position.y = LID_Y;
  group.add(lidMesh);

  // Screen: a square plane recessed into the lid opening (its edges hide
  // beneath the lid ring), playing the first section's console plasma.
  const orbGeo = track(new THREE.PlaneGeometry(ORB_PLANE_SIZE, ORB_PLANE_SIZE));
  orbGeo.rotateX(-Math.PI / 2);
  const orbMesh = new THREE.Mesh(orbGeo, orbMaterial);
  orbMesh.position.y = ORB_PLANE_Y;
  group.add(orbMesh);

  // Louver banks on the two camera-facing walls, toward the far ends.
  const ventGeo = track(new THREE.PlaneGeometry(VENT_W, VENT_H));
  const ventFront = new THREE.Mesh(ventGeo, ventMaterial);
  ventFront.position.set(VENT_CENTER, VENT_Y, SIZE / 2 + 0.0015);
  group.add(ventFront);
  const ventRight = new THREE.Mesh(ventGeo, ventMaterial);
  ventRight.rotation.y = Math.PI / 2;
  ventRight.position.set(SIZE / 2 + 0.0015, VENT_Y, VENT_CENTER);
  group.add(ventRight);

  // Etched wall lines (sides only): a continuous seam groove running just
  // under the lid across both visible walls, and a vertical dashed groove
  // tucked toward each wall's near-corner end, after the reference.
  const etchSeamGeo = track(new THREE.PlaneGeometry(ETCH_SEAM_W, ETCH_SEAM_H));
  const seamFront = new THREE.Mesh(etchSeamGeo, etchSeamMaterial);
  seamFront.position.set(0, ETCH_SEAM_Y, SIZE / 2 + 0.0015);
  group.add(seamFront);
  const seamRight = new THREE.Mesh(etchSeamGeo, etchSeamMaterial);
  seamRight.rotation.y = Math.PI / 2;
  seamRight.position.set(SIZE / 2 + 0.0015, ETCH_SEAM_Y, 0);
  group.add(seamRight);

  // Vertical dashes: the plane is built lying along X (so the dash texture
  // runs down its length) and spun 90deg about Z to stand upright.
  const etchDashGeo = track(new THREE.PlaneGeometry(ETCH_DASH_H, ETCH_DASH_W));
  etchDashGeo.rotateZ(Math.PI / 2);
  const dashFront = new THREE.Mesh(etchDashGeo, etchDashMaterial);
  dashFront.position.set(ETCH_DASH_POS, ETCH_DASH_Y, SIZE / 2 + 0.0015);
  group.add(dashFront);
  const dashRight = new THREE.Mesh(etchDashGeo, etchDashMaterial);
  dashRight.rotation.y = Math.PI / 2;
  dashRight.position.set(SIZE / 2 + 0.0015, ETCH_DASH_Y, ETCH_DASH_POS);
  group.add(dashRight);

  // Status LED strip above the front louver bank. One emissive material per
  // dot so the chase animation can pulse them in sequence.
  const ledGeo = track(new THREE.CircleGeometry(LED_RADIUS, 24));
  const ledMaterials: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < LED_COUNT; i += 1) {
    const ledMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1208,
      emissive: 0xffa028,
      emissiveIntensity: 0.12,
      metalness: 0.1,
      roughness: 0.4,
    });
    ledMaterials.push(ledMaterial);
    const led = new THREE.Mesh(ledGeo, ledMaterial);
    led.position.set(
      LED_START_X + i * LED_SPACING,
      LED_Y,
      SIZE / 2 + 0.0015,
    );
    group.add(led);
  }

  // Hover glow rig: one additive halo sprite behind each computer in the
  // stack, plus a per-tier registry of line materials that brighten while
  // their computer is hovered (the ghost loop below fills these in with its
  // per-ghost material clones). The sprites render first (renderOrder -1,
  // no depth test) so the solid device occludes the glow — its own halo,
  // centered below the base, reads as light spilling out from underneath.
  const glowTexture = createGlowTexture();
  interface TierGlow {
    spriteMaterial: THREE.SpriteMaterial;
    lineMaterials: {
      material: THREE.LineBasicMaterial | THREE.MeshBasicMaterial;
      baseOpacity: number;
    }[];
    level: number;
  }
  const tierCenterY: Record<DeviceTier, number> = {
    top: GHOST_ABOVE_Y + GLOW_CENTER_Y,
    middle: GLOW_MIDDLE_Y,
    bottom: GHOST_BELOW_Y + GLOW_CENTER_Y,
  };
  const tierGlows = {} as Record<DeviceTier, TierGlow>;
  // Per-ghost material clones (the base ghost materials are shared recipes;
  // brightening one hovered ghost needs its own instances). Collected here
  // for disposal.
  const hoverMaterials: THREE.Material[] = [];
  for (const tier of DEVICE_TIERS) {
    const spriteMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    hoverMaterials.push(spriteMaterial);
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(0, tierCenterY[tier], 0);
    sprite.scale.set(GLOW_SCALE_X, GLOW_SCALE_Y, 1);
    sprite.renderOrder = -1;
    group.add(sprite);
    tierGlows[tier] = { spriteMaterial, lineMaterials: [], level: 0 };
  }

  // Ghost outline computers above and below the real device, drawn as a
  // schematic wireframe in three line "weights" (WebGL lines are always
  // 1px, so weight is faked with brightness/opacity tiers): a strong outer
  // silhouette (top rim doubled for a heavier read + corner verticals),
  // mid-tier structural seams (lid seam, base, screen recess, and the
  // provider-logo quadrant on the top computer's plate), and faint interior
  // detail (case seam, recessed-plate echo, vent hatching).
  const ghostStrongMaterial = new THREE.LineBasicMaterial({
    color: 0x9aa0a8,
    transparent: true,
    opacity: 0.55,
  });
  const ghostMidMaterial = new THREE.LineBasicMaterial({
    color: 0x7a7f86,
    transparent: true,
    opacity: 0.32,
  });
  const ghostFaintMaterial = new THREE.LineBasicMaterial({
    color: 0x6a6f76,
    transparent: true,
    opacity: 0.18,
  });

  const ghostFootprint = roundedSquare(SIZE, CORNER_R);
  const lidSeamY = LID_Y - LID_BEVEL;
  // The top rim and its echo are full loops (the whole plate is visible on
  // the real device too); the body seams below are near-side arcs only, so
  // the wireframe body reads with the same apparent height as the solid
  // computer instead of stacking far-side arcs down the screen.
  const ghostTopGeo = track(outlineLoop(ghostFootprint, DEVICE_H));
  const ghostTopUnderGeo = track(outlineLoop(ghostFootprint, DEVICE_H - 0.016));
  const ghostLidSeamGeo = track(nearArc(ghostFootprint, lidSeamY));
  const ghostCaseSeamGeo = track(nearArc(ghostFootprint, CASE_BOTTOM));
  // Top-plate detail: the screen recess plus a fainter inner echo.
  const ghostHoleGeo = track(
    outlineLoop(roundedSquare(HOLE_SIZE, HOLE_R), DEVICE_H),
  );
  const ghostPlateGeo = track(
    outlineLoop(roundedSquare(HOLE_SIZE - 0.18, HOLE_R - 0.05), DEVICE_H),
  );

  // Silhouette verticals at the three VISIBLE rounded corners (the far
  // corner is hidden on the solid device, so the ghost skips it too). They
  // run from the case seam up to the top rim, with a per-vertex color
  // gradient: bright at the rim, fading down to the faint case-seam color
  // so each vertical melts into the bottom line. (The fade is baked into
  // the vertex COLOR — scaled toward black to emulate the faint tier's
  // lower opacity over the dark page — since line opacity is per-material.)
  const cornerTopColor = new THREE.Color(0x9aa0a8);
  const cornerBottomColor = new THREE.Color(0x6a6f76).multiplyScalar(
    0.18 / 0.55,
  );
  const ghostCornerPts: number[] = [];
  const ghostCornerColors: number[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1]]) {
    ghostCornerPts.push(
      sx * GHOST_CORNER, CASE_BOTTOM, sz * GHOST_CORNER,
      sx * GHOST_CORNER, DEVICE_H, sz * GHOST_CORNER,
    );
    ghostCornerColors.push(
      cornerBottomColor.r, cornerBottomColor.g, cornerBottomColor.b,
      cornerTopColor.r, cornerTopColor.g, cornerTopColor.b,
    );
  }
  const ghostCornerGeo = track(new THREE.BufferGeometry());
  ghostCornerGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(ghostCornerPts, 3),
  );
  ghostCornerGeo.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(ghostCornerColors, 3),
  );
  const ghostCornerMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
  });

  // Provider-logo quadrant on the top plate (only the upper ghost carries
  // it): four flat decals lying in the x-z plane, gray-tinted like the
  // wireframe, whose opacity/height/mark are animated per frame in
  // `updateLogoQuads`. Each mesh is counter-yawed against the group's
  // diamond pose so the marks read upright to the viewer.
  const logoTextures = createProviderLogoTextures(maxAniso);
  const logoGeo = track(
    new THREE.PlaneGeometry(LOGO_QUAD_SIZE, LOGO_QUAD_SIZE),
  );
  logoGeo.rotateX(-Math.PI / 2);
  interface LogoQuad {
    material: THREE.MeshBasicMaterial;
    mesh: THREE.Mesh;
    /** Quadrant slot (0..3); also the per-quad stagger step. */
    slot: number;
    /** Y of the plate face this quad's drift is centered on (world). */
    baseY: number;
    /** Cycle number whose mark is currently mapped, to detect swaps. */
    cycle: number;
  }
  const logoQuads: LogoQuad[] = [];
  const logoMaterials: THREE.MeshBasicMaterial[] = [];

  // Louver hatching on the two visible walls, mirroring the real vents.
  const hatchPts: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    const along = -0.55 + (i * 0.42) / 8;
    hatchPts.push(along, 0.21, SIZE / 2, along, 0.39, SIZE / 2);
    hatchPts.push(SIZE / 2, 0.21, along, SIZE / 2, 0.39, along);
  }
  const ghostHatchGeo = track(new THREE.BufferGeometry());
  ghostHatchGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(hatchPts, 3),
  );

  for (const yOffset of [GHOST_ABOVE_Y, GHOST_BELOW_Y]) {
    const tier: DeviceTier = yOffset === GHOST_ABOVE_Y ? "top" : "bottom";
    // Each ghost gets its own clones of the shared line materials so the
    // hovered ghost can brighten independently of the other one.
    const strong = ghostStrongMaterial.clone();
    const mid = ghostMidMaterial.clone();
    const faint = ghostFaintMaterial.clone();
    const corner = ghostCornerMaterial.clone();
    hoverMaterials.push(strong, mid, faint, corner);
    tierGlows[tier].lineMaterials.push(
      { material: strong, baseOpacity: strong.opacity },
      { material: mid, baseOpacity: mid.opacity },
      { material: faint, baseOpacity: faint.opacity },
      { material: corner, baseOpacity: corner.opacity },
    );

    const ghost = new THREE.Group();
    ghost.add(new THREE.Line(ghostTopGeo, strong));
    ghost.add(new THREE.Line(ghostTopUnderGeo, faint));
    ghost.add(new THREE.Line(ghostLidSeamGeo, mid));
    ghost.add(new THREE.Line(ghostCaseSeamGeo, faint));
    ghost.add(new THREE.Line(ghostHoleGeo, mid));
    ghost.add(new THREE.Line(ghostPlateGeo, faint));
    ghost.add(new THREE.LineSegments(ghostCornerGeo, corner));
    ghost.add(new THREE.LineSegments(ghostHatchGeo, faint));
    // Only the top computer carries the provider-logo quadrant; the bottom
    // one's plate stays bare.
    if (yOffset === GHOST_ABOVE_Y) {
      const quadCorners: Array<[number, number]> = [
        [-LOGO_QUAD_OFFSET, -LOGO_QUAD_OFFSET],
        [LOGO_QUAD_OFFSET, -LOGO_QUAD_OFFSET],
        [-LOGO_QUAD_OFFSET, LOGO_QUAD_OFFSET],
        [LOGO_QUAD_OFFSET, LOGO_QUAD_OFFSET],
      ];
      for (let slot = 0; slot < quadCorners.length; slot += 1) {
        const [qx, qz] = quadCorners[slot];
        const material = new THREE.MeshBasicMaterial({
          map: logoTextures[slot % logoTextures.length],
          color: 0x9aa0a8,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        logoMaterials.push(material);
        const mesh = new THREE.Mesh(logoGeo, material);
        mesh.rotation.y = -BASE_YAW; // undo the diamond yaw: marks face the viewer
        mesh.position.set(qx, DEVICE_H + 0.002, qz);
        ghost.add(mesh);
        logoQuads.push({
          material,
          mesh,
          slot,
          baseY: DEVICE_H + 0.002,
          cycle: 0,
        });
      }
    }
    ghost.position.y = yOffset;
    group.add(ghost);
  }

  // Dashed connector columns between the devices: an upper run spanning the
  // gap from the main lid top to the upper ghost's bottom seam line, and a
  // lower run from the lower ghost's top rim to the main computer's
  // underside. The dash Y positions are rewritten every frame (a conveyor
  // hard-clamped to each run's bounds), so dashes shrink in at a run's top
  // edge and shrink out at its bottom — never poking past the wireframe's
  // bottom line the way a slide-and-wrap pattern would.
  const dashMaterial = new THREE.LineBasicMaterial({
    color: 0x70757c,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const elevTan = Math.tan(THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG));
  const ghostSeamY = GHOST_ABOVE_Y + CASE_BOTTOM;
  interface DashColumn {
    line: THREE.LineSegments;
    runs: { start: number; end: number; count: number }[];
  }
  const dashColumns: DashColumn[] = [];
  // Three columns only (middle by the near corner, sides on the lid ring's
  // side corners at the `DASH_SIDE` diagonal): the far corner is skipped
  // because in the diamond pose it projects onto the same screen vertical
  // as the near column, interleaving with it into what reads as a doubled
  // center line.
  const dashAnchors: Array<[number, number]> = [
    [DASH_INSET, DASH_INSET],
    [-DASH_SIDE, DASH_SIDE],
    [DASH_SIDE, -DASH_SIDE],
  ];
  for (const [px, pz] of dashAnchors) {
    // Each column is inset behind the ghost's near silhouette, so its upper
    // run must stop short of the seam's world height by the depth gap times
    // tan(elevation) — exactly where the column's projection crosses the
    // ghost's bottom diagonal edge on screen.
    const colViewX = px * Math.cos(BASE_YAW) + pz * Math.sin(BASE_YAW);
    const colViewZ = -px * Math.sin(BASE_YAW) + pz * Math.cos(BASE_YAW);
    const edgeViewZ = nearSilhouetteDepth(ghostFootprint, colViewX);
    const upperEnd = ghostSeamY - (edgeViewZ - colViewZ) * elevTan;
    const runs = [
      // Main top surface -> the upper ghost's bottom (case seam) line, as
      // it appears on screen at this column's position.
      { start: DEVICE_H, end: upperEnd },
      // Lower ghost top rim -> the main computer's underside.
      { start: GHOST_BELOW_Y + DEVICE_H, end: 0 },
    ].map((run) => ({
      ...run,
      count: Math.ceil((run.end - run.start) / DASH_PERIOD) + 1,
    }));
    const dashTotal = runs.reduce((n, run) => n + run.count, 0);
    const arr = new Float32Array(dashTotal * 6);
    for (let i = 0; i < dashTotal; i += 1) {
      arr[i * 6] = px;
      arr[i * 6 + 2] = pz;
      arr[i * 6 + 3] = px;
      arr[i * 6 + 5] = pz;
    }
    const dashAttr = new THREE.BufferAttribute(arr, 3);
    dashAttr.setUsage(THREE.DynamicDrawUsage);
    const dashGeo = track(new THREE.BufferGeometry());
    dashGeo.setAttribute("position", dashAttr);
    const line = new THREE.LineSegments(dashGeo, dashMaterial);
    // The Y values are rewritten per frame; skip culling against the
    // initial (degenerate) bounds.
    line.frustumCulled = false;
    dashColumns.push({ line, runs });
    group.add(line);
  }

  /** Rewrite every column's dash Y spans for time `t` (conveyor downward). */
  function updateDashes(t: number): void {
    for (const column of dashColumns) {
      const attr = column.line.geometry.attributes
        .position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let seg = 0;
      for (const run of column.runs) {
        const cycle = run.count * DASH_PERIOD;
        for (let i = 0; i < run.count; i += 1) {
          const p = run.end - ((i * DASH_PERIOD + t * DASH_SPEED) % cycle);
          const y0 = Math.max(run.start, p);
          const y1 = Math.min(run.end, Math.max(run.start, p + DASH_LEN));
          arr[seg * 6 + 1] = y0;
          arr[seg * 6 + 4] = y1;
          seg += 1;
        }
      }
      attr.needsUpdate = true;
    }
  }
  updateDashes(0);

  /**
   * Drive the top plate's provider-logo quadrant for time `t`: each quad
   * runs the shared fade-in -> hold -> fade-out -> hidden-gap cycle a
   * quarter-cycle apart, drifting gently upward while visible (echoing the
   * dash conveyor) and swapping to the next provider mark while invisible
   * (the wrap point sits inside the hidden gap, so swaps never pop). The
   * hover boost folds into the opacity here — the quads are NOT registered
   * in `tierGlows`, whose pass would otherwise fight this per-frame
   * envelope for `material.opacity`.
   */
  function updateLogoQuads(t: number): void {
    const boost = 1 + GHOST_HOVER_BOOST * tierGlows.top.level;
    const stagger = LOGO_CYCLE_S / logoQuads.length;
    for (const quad of logoQuads) {
      const phase = t + quad.slot * stagger;
      const local = phase % LOGO_CYCLE_S;
      const cycle = Math.floor(phase / LOGO_CYCLE_S);
      if (cycle !== quad.cycle) {
        quad.cycle = cycle;
        // Step every slot by the quad count so the four quads always show
        // four distinct providers while still visiting the whole roster.
        quad.material.map =
          logoTextures[
            (quad.slot + cycle * logoQuads.length) % logoTextures.length
          ];
      }
      let envelope = 0;
      if (local < LOGO_VISIBLE_S) {
        const fadeIn = THREE.MathUtils.smoothstep(local, 0, LOGO_FADE_S);
        const fadeOut =
          1 -
          THREE.MathUtils.smoothstep(
            local,
            LOGO_VISIBLE_S - LOGO_FADE_S,
            LOGO_VISIBLE_S,
          );
        envelope = Math.min(fadeIn, fadeOut);
      }
      quad.material.opacity = LOGO_MAX_OPACITY * envelope * boost;
      const progress = Math.min(local / LOGO_VISIBLE_S, 1);
      quad.mesh.position.y = quad.baseY + (progress - 0.5) * LOGO_DRIFT;
    }
  }
  updateLogoQuads(0);

  // Hover detection: the camera pose is fixed, so instead of raycasting the
  // pointer is bucketed into three vertical bands split at the two stack
  // gaps (between the middle device's top and the upper ghost's bottom, and
  // between the middle device's bottom and the lower ghost's top). The
  // band boundaries live in NDC y and are recomputed on every camera fit.
  let hoveredTier: DeviceTier | null = null;
  let bandTopNdcY = 1;
  let bandBottomNdcY = -1;

  function fitCamera(aspect: number): void {
    // Orthographic frustum fixed to the diamond's width; the vertical extent
    // follows the host's aspect ratio, so a taller canvas reveals more of
    // the ghost stack (which crops at the top/bottom edges like the
    // reference composition). No perspective: every computer in the stack
    // projects at the same size.
    const halfW = CAMERA_VIEW_W / 2;
    const halfH = halfW / aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    const elev = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
    camera.position.set(
      0,
      CAMERA_TARGET_Y + Math.sin(elev) * CAMERA_DISTANCE,
      Math.cos(elev) * CAMERA_DISTANCE,
    );
    camera.lookAt(0, CAMERA_TARGET_Y, 0);
    camera.updateProjectionMatrix();
    bandTopNdcY = new THREE.Vector3(0, (DEVICE_H + GHOST_ABOVE_Y) / 2, 0)
      .project(camera).y;
    bandBottomNdcY = new THREE.Vector3(0, (GHOST_BELOW_Y + DEVICE_H) / 2, 0)
      .project(camera).y;
  }
  fitCamera(width / height);

  function setHoveredTier(tier: DeviceTier | null): void {
    if (tier === hoveredTier) return;
    hoveredTier = tier;
    options.onHoverChange?.(tier);
  }

  const onPointerMove = (event: PointerEvent): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.height === 0) return;
    const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    setHoveredTier(
      ndcY > bandTopNdcY ? "top" : ndcY < bandBottomNdcY ? "bottom" : "middle",
    );
  };
  const onPointerLeave = (): void => setHoveredTier(null);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);

  function renderFrame(): void {
    renderer.render(scene, camera);
  }

  // LED chase: each dot pulses with a phase offset down the strip, so a
  // bright "beep" runs left-to-right with a faint resting glow between hits.
  // Always animating (paused only while the tab is hidden): like the hero
  // console's `AuraScreenOrb`, the plasma screen is an ambient living
  // readout, so it keeps looping rather than honoring reduced motion with a
  // frozen frame.
  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;
  let lastTime = 0;

  function animate(): void {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const dt = Math.min(Math.max(t - lastTime, 0), 0.1);
    lastTime = t;
    orbUniforms.u_time.value = t;
    for (let i = 0; i < ledMaterials.length; i += 1) {
      const pulse = Math.pow(Math.max(0, Math.sin(t * 2.4 - i * 0.7)), 8);
      ledMaterials[i].emissiveIntensity = 0.12 + 2.2 * pulse;
    }
    // Stream the connector dashes downward through their runs.
    updateDashes(t);
    // Hover glow: each tier's level eases toward hovered (1) or idle (0),
    // driving its halo sprite's opacity and the ghost wireframe
    // brightening. The solid middle device's materials stay untouched —
    // its halo under the base carries the whole effect.
    const ease = 1 - Math.exp(-GLOW_FADE_RATE * dt);
    for (const tier of DEVICE_TIERS) {
      const glow = tierGlows[tier];
      const target = hoveredTier === tier ? 1 : 0;
      glow.level += (target - glow.level) * ease;
      glow.spriteMaterial.opacity = GLOW_MAX_OPACITY * glow.level;
      for (const entry of glow.lineMaterials) {
        entry.material.opacity =
          entry.baseOpacity * (1 + GHOST_HOVER_BOOST * glow.level);
      }
    }
    // After the glow pass so the quads fold in the settled hover level.
    updateLogoQuads(t);
    renderFrame();
  }

  function start(): void {
    if (running) return;
    running = true;
    clock.start();
    lastTime = 0;
    animate();
  }

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVisibilityChange = (): void => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const resizeObserver = new ResizeObserver(() => {
    const w = host.clientWidth || width;
    const h = host.clientHeight || height;
    renderer.setSize(w, h);
    fitCamera(w / h);
    if (!running) renderFrame();
  });
  resizeObserver.observe(host);

  start();

  return {
    dispose(): void {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      resizeObserver.disconnect();
      for (const ledMaterial of ledMaterials) ledMaterial.dispose();
      for (const hoverMaterial of hoverMaterials) hoverMaterial.dispose();
      glowTexture.dispose();
      for (const geo of geometries) geo.dispose();
      caseMaterial.dispose();
      orbMaterial.dispose();
      baseMaterial.dispose();
      ventMaterial.dispose();
      ghostStrongMaterial.dispose();
      ghostMidMaterial.dispose();
      ghostFaintMaterial.dispose();
      ghostCornerMaterial.dispose();
      for (const logoMaterial of logoMaterials) logoMaterial.dispose();
      for (const logoTexture of logoTextures) logoTexture.dispose();
      dashMaterial.dispose();
      etchSeamMaterial.dispose();
      etchDashMaterial.dispose();
      caseTexture.dispose();
      ventTexture.dispose();
      etchSeamTexture.dispose();
      etchDashTexture.dispose();
      envRT.texture.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (host.contains(renderer.domElement)) {
        host.removeChild(renderer.domElement);
      }
    },
  };
}
