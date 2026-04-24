import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface LoadedModel {
  object: THREE.Group;
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
}

export function loadModel(
  url: string,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
): Promise<LoadedModel> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");

    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((resourceUrl: string) => {
      if (resourceUrl.startsWith("blob:")) return resourceUrl;
      if (resourceUrl.includes("amazonaws.com") || resourceUrl.includes("s3")) {
        return resourceUrl.replace(/^http:/, "https:");
      }
      return resourceUrl;
    });
    loader.manager = loadingManager;

    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;

        // Center and scale to fit
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const scale = 2 / maxDim;
          model.scale.multiplyScalar(scale);
          box.setFromObject(model);
          center.copy(box.getCenter(new THREE.Vector3()));
          size.copy(box.getSize(new THREE.Vector3()));
        }

        // Position above grid, centered horizontally
        model.position.x = -center.x;
        model.position.z = -center.z;
        const bottomY = box.min.y - center.y + model.position.y;
        model.position.y = -bottomY + 0.05;

        // Store original materials for wireframe/texture toggling
        const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            originalMaterials.set(
              child,
              Array.isArray(child.material)
                ? child.material.map((m) => m.clone())
                : child.material.clone(),
            );
          }
        });

        scene.add(model);

        // Frame camera to view model
        const scaledSize = box.getSize(new THREE.Vector3());
        const maxScaledDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
        const dist = maxScaledDim * 1.8;
        camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
        controls.target.set(0, scaledSize.y * 0.3, 0);
        controls.update();

        resolve({ object: model, originalMaterials });
      },
      undefined,
      (error) => {
        reject(new Error(`Failed to load model: ${error instanceof Error ? error.message : String(error)}`));
      },
    );
  });
}

export function disposeModel(
  model: LoadedModel,
  scene: THREE.Scene,
): void {
  scene.remove(model.object);
  model.object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        mat.dispose();
      }
    }
  });
  for (const [, mat] of model.originalMaterials) {
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      m.dispose();
    }
  }
  model.originalMaterials.clear();
}

export function applyWireframe(model: THREE.Group, wireframe: boolean): void {
  const wireMaterial = wireframe
    ? new THREE.MeshBasicMaterial({ color: 0x4466ff, wireframe: true, opacity: 0.8, transparent: true })
    : null;

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (wireframe && wireMaterial) {
        child.material = wireMaterial;
      }
    }
  });
}

export function applyTextures(
  model: THREE.Group,
  showTextures: boolean,
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
): void {
  const flatMaterial = !showTextures
    ? new THREE.MeshPhongMaterial({ color: 0x8899aa })
    : null;

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (showTextures) {
        const original = originalMaterials.get(child);
        if (original) {
          child.material = Array.isArray(original)
            ? original.map((m) => m.clone())
            : original.clone();
        }
      } else if (flatMaterial) {
        child.material = flatMaterial;
      }
    }
  });
}
