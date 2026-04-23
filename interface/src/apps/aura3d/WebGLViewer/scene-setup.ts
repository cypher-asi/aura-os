import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  gridHelper: THREE.GridHelper | null;
}

export function createScene(container: HTMLDivElement): SceneContext {
  const width = container.clientWidth;
  const height = container.clientHeight || 300;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(3, 3, 3);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);
  controls.update();

  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xf0f4ff, 0.4);
  scene.add(ambientLight);

  // Key light — warm white from above right
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(5, 10, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  scene.add(keyLight);

  // Fill light — cooler tone from left
  const fillLight = new THREE.DirectionalLight(0x8099ff, 0.5);
  fillLight.position.set(-5, 5, -5);
  scene.add(fillLight);

  // Rim light — edge highlighting from behind
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
  rimLight.position.set(0, 5, -10);
  scene.add(rimLight);

  // Bottom light — fill shadows from below
  const bottomLight = new THREE.DirectionalLight(0x4466ff, 0.3);
  bottomLight.position.set(0, -10, 0);
  scene.add(bottomLight);

  // Grid (initially visible)
  const gridHelper = new THREE.GridHelper(12, 24, 0x4466ff, 0x1a2244);
  (gridHelper.material as THREE.Material).opacity = 0.4;
  (gridHelper.material as THREE.Material).transparent = true;
  scene.add(gridHelper);

  return { scene, camera, renderer, controls, gridHelper };
}

export function disposeScene(ctx: SceneContext, container: HTMLDivElement | null): void {
  ctx.controls.dispose();

  ctx.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) {
        for (const key of Object.keys(mat)) {
          const val = (mat as Record<string, unknown>)[key];
          if (val && typeof val === "object" && "isTexture" in val) {
            (val as THREE.Texture).dispose();
          }
        }
        mat.dispose();
      }
    }
  });

  while (ctx.scene.children.length > 0) {
    ctx.scene.remove(ctx.scene.children[0]);
  }

  ctx.renderer.renderLists.dispose();
  ctx.renderer.dispose();
  ctx.renderer.forceContextLoss();

  if (container?.contains(ctx.renderer.domElement)) {
    container.removeChild(ctx.renderer.domElement);
  }
}
