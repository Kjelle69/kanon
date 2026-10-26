import * as THREE from "/vendor/three.module.js";
import { GLTFLoader } from "/vendor/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "/vendor/addons/loaders/FBXLoader.js";

// Source coordinates inspected from the supplied seven-part GLB. Forward is -Z,
// up is +Y. Cube_001 is the barrel; the other six parts form the carriage.
export const CANNON_CALIBRATION = Object.freeze({
  scale: 0.018,
  centerX: -30.59,
  floorY: -77.984,
  pivot: [-0.27, 1.764, 0],
  muzzle: [2.2005, 1.854, 0],
});
let cache;
export function loadModels() {
  if (cache) return cache;
  cache = (async () => {
    const loader = new GLTFLoader();
    // Original embedded textures are extracted at build time. Resolving them as
    // same-origin images avoids blob fetches forbidden by the existing CSP.
    const images = await fetch("/assets/models/image-manifest.json").then(
      (r) => {
        if (!r.ok) throw Error("Bildmanifest saknas");
        return r.json();
      },
    );
    loader.register((parser) => ({
      name: "KANON_same_origin_images",
      beforeRoot() {
        parser.json.images?.forEach((image, i) => {
          image.uri = new URL(images[i], location.origin).href;
          delete image.bufferView;
        });
      },
    }));
    const gltf = await loader.loadAsync("/assets/models/cannon.glb");
    gltf.scene.updateMatrixWorld(true);
    const base = new THREE.Group(),
      barrel = new THREE.Group();
    const c = CANNON_CALIBRATION;
    const normalize = new THREE.Matrix4()
      .makeRotationY(-Math.PI / 2)
      .multiply(new THREE.Matrix4().makeScale(c.scale, c.scale, c.scale))
      .multiply(new THREE.Matrix4().makeTranslation(-c.centerX, -c.floorY, 0));
    const parts = [];
    gltf.scene.traverse((node) => {
      if (!node.isMesh) return;
      const geometry = node.geometry
        .clone()
        .applyMatrix4(node.matrixWorld)
        .applyMatrix4(normalize);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, node.material);
      mesh.name = node.name;
      mesh.userData.sharedAsset = true;
      parts.push(node.name);
      (node.name.endsWith("Cube_001") ? barrel : base).add(mesh);
    });
    if (!barrel.children.length)
      throw Error("Kanonens kalibrerade pipdel saknas");
    // Move barrel vertices into a trunnion-local coordinate system.
    for (const mesh of barrel.children)
      mesh.geometry.translate(...c.pivot.map((v) => -v));
    let ball = null,
      ballStatus = "sfär (FBX saknas)";
    try {
      const response = await fetch("/assets/models/cannonball.fbx", {
        method: "HEAD",
      });
      const glb =
        !response.ok &&
        (await fetch("/assets/models/cannonball.glb", { method: "HEAD" })).ok;
      if (response.ok || glb) {
        ball = glb
          ? (await new GLTFLoader().loadAsync("/assets/models/cannonball.glb"))
              .scene
          : await new FBXLoader().loadAsync("/assets/models/cannonball.fbx");
        const box = new THREE.Box3().setFromObject(ball),
          size = box.getSize(new THREE.Vector3()),
          center = box.getCenter(new THREE.Vector3());
        if (!Number.isFinite(size.length()) || size.length() === 0)
          throw Error("Tom kulmodell");
        const wrapper = new THREE.Group();
        ball.position.sub(center);
        wrapper.add(ball);
        wrapper.scale.setScalar(2 / Math.max(size.x, size.y, size.z));
        ball = wrapper;
        ball.traverse((o) => {
          o.userData.sharedAsset = true;
        });
        ballStatus = glb ? "cannonball.glb" : "FBX";
      }
    } catch (error) {
      ball = null;
      ballStatus = "sfär (FBX kunde inte laddas)";
      console.warn("Kulmodell:", error.message);
    }
    return { base, barrel, ball, parts, ballStatus, sourceBytes: 6366400 };
  })().catch((error) => {
    cache = null;
    throw error;
  });
  return cache;
}
export function createCannonVisual(assets) {
  const yaw = new THREE.Group(),
    elevation = new THREE.Group(),
    recoil = new THREE.Group();
  const base = assets.base.clone(true),
    barrel = assets.barrel.clone(true);
  elevation.position.fromArray(CANNON_CALIBRATION.pivot);
  const muzzle = new THREE.Object3D();
  muzzle.position.fromArray(CANNON_CALIBRATION.muzzle).sub(elevation.position);
  recoil.add(barrel, muzzle);
  elevation.add(recoil);
  yaw.add(base, elevation);
  return {
    root: yaw,
    elevation,
    recoil,
    muzzle,
    model: "cannon.glb",
    parts: assets.parts.length,
  };
}

let characterCache;
export function loadCharacter() {
  if (!characterCache)
    characterCache = (async () => {
      // Accept the supplied filename while supporting the requested canonical name.
      let url = "/assets/models/MrTrebuchet.glb";
      if (!(await fetch(url, { method: "HEAD" })).ok)
        url = "/assets/models/MrTreb.glb";
      const gltf = await new GLTFLoader().loadAsync(url);
      const remove = [];
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.material?.name?.includes("dark_display_base"))
          remove.push(o);
      });
      remove.forEach((o) => o.removeFromParent());
      gltf.scene.rotation.y = Math.PI / 2;
      const root = new THREE.Group();
      root.add(gltf.scene);
      const box = new THREE.Box3().setFromObject(root),
        size = box.getSize(new THREE.Vector3());
      const scale = 1.7 / size.y;
      gltf.scene.position.set(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      );
      root.scale.setScalar(scale);
      // Model front is +Z; turn to canonical +X. Keep source untouched.
      root.traverse((o) => {
        o.userData.sharedAsset = true;
        if (o.isMesh) {
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          for (const m of materials) {
            if ("metalness" in m)
              m.metalness = Math.max(0, Math.min(0.65, m.metalness));
          }
        }
      });
      return { root, url, height: 1.7 };
    })().catch((e) => {
      characterCache = null;
      throw e;
    });
  return characterCache;
}
