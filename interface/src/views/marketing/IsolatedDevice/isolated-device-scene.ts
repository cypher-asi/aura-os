import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface IsolatedDeviceSceneOptions {
  reducedMotion: boolean;
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
 * reference render: a squircle-footprint case with a rounded-over lid edge,
 * a recessed top plate carrying four corner screws and a centered embossed
 * logo, all sitting on a slightly inset base plinth. Vertical layout (y-up):
 *
 *   0.00 .. 0.14  base plinth (inset)
 *   0.12 .. 0.47  case band (full footprint, carries the louver banks)
 *   0.46 .. 0.57  lid (bevelled ring with the recessed plate inside)
 */
const SIZE = 2;
const CORNER_R = 0.4;

const BASE_SILHOUETTE = 1.86;
const BASE_BEVEL = 0.015;
const BASE_DEPTH = 0.11; // + 2 * bevel = 0.14 tall
const BASE_Y = 0.015;

const CASE_BOTTOM = 0.12;
const CASE_TOP = 0.47;

const LID_BEVEL = 0.03;
const LID_DEPTH = 0.05; // + 2 * bevel = 0.11 tall
const LID_Y = 0.49; // bottom bevel tucks to 0.46; top face lands at 0.57

/** Rounded-square opening cut through the lid ring (shape-local size). */
const HOLE_SIZE = 1.46;
const HOLE_R = 0.26;

const PLATE_SIZE = 1.5;
const PLATE_R = 0.27;
const PLATE_BEVEL = 0.012;
const PLATE_DEPTH = 0.02;
const PLATE_TOP = 0.545; // recessed 0.025 below the lid top
const PLATE_Y = PLATE_TOP - PLATE_DEPTH - PLATE_BEVEL;

const SCREW_OFFSET = 0.585;
const SCREW_RADIUS = 0.034;
const SCREW_HEIGHT = 0.016;

const LOGO_SIZE = 0.6;

/** Louver bank planes on the case walls, tucked toward the far wall ends. */
const VENT_W = 0.48;
const VENT_H = 0.22;
const VENT_CENTER = -0.34; // along the wall, clear of the corner rounding
const VENT_Y = 0.3; // vertical center within the case band

/** Resting pose: the near vertical corner points at the camera. */
const BASE_YAW = -Math.PI / 4;
const CAMERA_ELEVATION_DEG = 32;
const CAMERA_TARGET_Y = 0.24;

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
 * Embossed logo decal (transparent canvas): a rounded-square outline with a
 * downward chevron, drawn as a light stroke offset under a dark stroke so it
 * reads as stamped into the metal. Laid as a plane on the recessed plate.
 */
function createLogoTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const drawMark = (offset: number, style: string): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.roundRect(96 + offset, 96 + offset, 320, 320, 48);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(186 + offset, 226 + offset);
      ctx.lineTo(256 + offset, 300 + offset);
      ctx.lineTo(326 + offset, 226 + offset);
      ctx.stroke();
    };
    // Light lip below-right, then the dark engraved line on top.
    drawMark(4, "rgba(255, 255, 255, 0.10)");
    drawMark(0, "rgba(0, 0, 0, 0.55)");
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
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

/** Soft contact shadow pooled under the device on the ground plane. */
function createShadowTexture(): THREE.CanvasTexture {
  const size = 512;
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
    grad.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    grad.addColorStop(0.5, "rgba(0, 0, 0, 0.28)");
    grad.addColorStop(0.78, "rgba(0, 0, 0, 0)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * WebGL "isolated device" scene — a dark matte-metal Mac-mini-style appliance
 * modelled after the reference render, framed diagonally from a high 3/4
 * angle. Idles with a gentle yaw sway and tilts toward the pointer; under
 * reduced motion it renders a single static frame (re-rendered on resize).
 */
export function createIsolatedDeviceScene(
  host: HTMLElement,
  options: IsolatedDeviceSceneOptions,
): IsolatedDeviceScene {
  const reducedMotion = options.reducedMotion;
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
  const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 100);

  // Environment for the metallic reflections; lights add directional shaping.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;

  const ambient = new THREE.AmbientLight(0x1a2028, 1.0);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2.5, 4, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fa3bf, 0.5);
  fill.position.set(-3, 1.5, -1);
  scene.add(fill);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Dark matte-metal palette, in the same family as the marketing metal cards.
  const caseTexture = createBrushedTexture("#191b1e", "#4a4f56");
  caseTexture.anisotropy = maxAniso;
  const caseMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2d31,
    map: caseTexture,
    metalness: 0.82,
    roughness: 0.45,
    envMapIntensity: 1.0,
  });
  const plateTexture = createBrushedTexture("#16181b", "#3c4046");
  plateTexture.anisotropy = maxAniso;
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x24262a,
    map: plateTexture,
    metalness: 0.8,
    roughness: 0.5,
    envMapIntensity: 0.85,
  });
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x17181a,
    metalness: 0.7,
    roughness: 0.6,
    envMapIntensity: 0.6,
  });
  const screwMaterial = new THREE.MeshStandardMaterial({
    color: 0x33363b,
    metalness: 0.95,
    roughness: 0.3,
    envMapIntensity: 1.1,
  });

  const logoTexture = createLogoTexture();
  const logoMaterial = new THREE.MeshStandardMaterial({
    map: logoTexture,
    transparent: true,
    metalness: 0.6,
    roughness: 0.6,
    depthWrite: false,
  });
  const ventTexture = createVentTexture();
  const ventMaterial = new THREE.MeshStandardMaterial({
    map: ventTexture,
    transparent: true,
    metalness: 0.2,
    roughness: 0.9,
    depthWrite: false,
  });
  const shadowTexture = createShadowTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
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

  // Lid: a beveled ring (the rounded-over edge) with the recessed-plate
  // opening cut through it; the bevel also chamfers into the recess.
  const lidShape = roundedSquare(SIZE - 2 * LID_BEVEL, CORNER_R - LID_BEVEL);
  lidShape.holes.push(roundedSquare(HOLE_SIZE, HOLE_R));
  const lidGeo = track(extrudeSlab(lidShape, LID_DEPTH, LID_BEVEL));
  const lidMesh = new THREE.Mesh(lidGeo, caseMaterial);
  lidMesh.position.y = LID_Y;
  group.add(lidMesh);

  // Recessed top plate filling the lid opening, sunk below the rim.
  const plateGeo = track(
    extrudeSlab(
      roundedSquare(PLATE_SIZE - 2 * PLATE_BEVEL, PLATE_R - PLATE_BEVEL),
      PLATE_DEPTH,
      PLATE_BEVEL,
    ),
  );
  const plateMesh = new THREE.Mesh(plateGeo, plateMaterial);
  plateMesh.position.y = PLATE_Y;
  group.add(plateMesh);

  // Four pan-head screws just inside the plate corners.
  const screwGeo = track(
    new THREE.CylinderGeometry(SCREW_RADIUS, SCREW_RADIUS, SCREW_HEIGHT, 24),
  );
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const screw = new THREE.Mesh(screwGeo, screwMaterial);
      screw.position.set(
        sx * SCREW_OFFSET,
        PLATE_TOP + SCREW_HEIGHT / 2 - 0.006,
        sz * SCREW_OFFSET,
      );
      group.add(screw);
    }
  }

  // Embossed logo decal lying on the plate center.
  const logoGeo = track(new THREE.PlaneGeometry(LOGO_SIZE, LOGO_SIZE));
  logoGeo.rotateX(-Math.PI / 2);
  const logoMesh = new THREE.Mesh(logoGeo, logoMaterial);
  logoMesh.position.y = PLATE_TOP + 0.002;
  group.add(logoMesh);

  // Louver banks on the two camera-facing walls, toward the far ends.
  const ventGeo = track(new THREE.PlaneGeometry(VENT_W, VENT_H));
  const ventFront = new THREE.Mesh(ventGeo, ventMaterial);
  ventFront.position.set(VENT_CENTER, VENT_Y, SIZE / 2 + 0.0015);
  group.add(ventFront);
  const ventRight = new THREE.Mesh(ventGeo, ventMaterial);
  ventRight.rotation.y = Math.PI / 2;
  ventRight.position.set(SIZE / 2 + 0.0015, VENT_Y, VENT_CENTER);
  group.add(ventRight);

  // Ground contact shadow (rotates with the group so it stays centered).
  const shadowGeo = track(new THREE.PlaneGeometry(3.8, 3.8));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMaterial);
  shadowMesh.position.y = -0.004;
  group.add(shadowMesh);

  function fitCamera(): void {
    // Frame to the device's diagonal footprint width with a small margin; the
    // long camera distance keeps the projection near-orthographic like the
    // reference photo.
    const margin = 1.12;
    const projectedW = SIZE * Math.SQRT2 * margin;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const dist = projectedW / 2 / Math.tan(vFov / 2) / camera.aspect;
    const elev = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
    camera.position.set(
      0,
      CAMERA_TARGET_Y + Math.sin(elev) * dist,
      Math.cos(elev) * dist,
    );
    camera.lookAt(0, CAMERA_TARGET_Y, 0);
    camera.updateProjectionMatrix();
  }
  fitCamera();

  function renderFrame(): void {
    renderer.render(scene, camera);
  }

  // Pointer tilt: the device leans gently toward the cursor over the card.
  let targetYawOffset = 0;
  let targetPitch = 0;
  const onPointerMove = (event: PointerEvent): void => {
    const rect = host.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    targetYawOffset = nx * 0.22;
    targetPitch = ny * 0.1;
  };
  const onPointerLeave = (): void => {
    targetYawOffset = 0;
    targetPitch = 0;
  };

  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;

  function animate(): void {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const sway = Math.sin(t * 0.45) * 0.05;
    const desiredYaw = BASE_YAW + sway + targetYawOffset;
    group.rotation.y += (desiredYaw - group.rotation.y) * 0.06;
    group.rotation.x += (targetPitch - group.rotation.x) * 0.06;
    renderFrame();
  }

  function start(): void {
    if (reducedMotion || running) return;
    running = true;
    clock.start();
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

  if (!reducedMotion) {
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  const resizeObserver = new ResizeObserver(() => {
    const w = host.clientWidth || width;
    const h = host.clientHeight || height;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    fitCamera();
    if (reducedMotion) renderFrame();
  });
  resizeObserver.observe(host);

  if (reducedMotion) {
    renderFrame();
  } else {
    start();
  }

  return {
    dispose(): void {
      stop();
      resizeObserver.disconnect();
      if (!reducedMotion) {
        host.removeEventListener("pointermove", onPointerMove);
        host.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      for (const geo of geometries) geo.dispose();
      caseMaterial.dispose();
      plateMaterial.dispose();
      baseMaterial.dispose();
      screwMaterial.dispose();
      logoMaterial.dispose();
      ventMaterial.dispose();
      shadowMaterial.dispose();
      caseTexture.dispose();
      plateTexture.dispose();
      logoTexture.dispose();
      ventTexture.dispose();
      shadowTexture.dispose();
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
