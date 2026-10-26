import { test, expect } from "@playwright/test";
test("supplied GLB loads with original textures and two articulated cannon instances", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { loadModels, createCannonVisual } = await import("/game/models.js");
    const THREE = await import("/vendor/three.module.js");
    const assets = await loadModels();
    const a = createCannonVisual(assets),
      b = createCannonVisual(assets);
    b.root.rotation.y = Math.PI;
    a.elevation.rotation.z = 0.3;
    b.elevation.rotation.z = 0.3;
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    const pa = a.muzzle.getWorldPosition(new THREE.Vector3()),
      pb = b.muzzle.getWorldPosition(new THREE.Vector3());
    return {
      parts: assets.parts.length,
      barrel: assets.barrel.children.length,
      textured: !!assets.base.children[0].material.map,
      size: new THREE.Box3()
        .setFromObject(a.root)
        .getSize(new THREE.Vector3())
        .toArray(),
      a: pa.toArray(),
      b: pb.toArray(),
      ball: assets.ballStatus,
    };
  });
  expect(result.parts).toBe(7);
  expect(result.barrel).toBe(1);
  expect(result.textured).toBe(true);
  expect(result.size[0]).toBeGreaterThan(3);
  expect(result.size[0]).toBeLessThan(7);
  expect(result.a[0]).toBeGreaterThan(1);
  expect(result.b[0]).toBeLessThan(-1);
  expect(result.a[1]).toBeCloseTo(result.b[1]);
  expect(errors).toEqual([]);
});

test("Mr Trebuchet is normalized to a grounded human scale and cannonball GLB is available", async ({
  page,
}) => {
  await page.goto("/");
  const model = await page.evaluate(async () => {
    const { loadCharacter, loadModels } = await import("/game/models.js");
    const THREE = await import("/vendor/three.module.js");
    const asset = await loadCharacter(),
      ball = await loadModels();
    const box = new THREE.Box3().setFromObject(asset.root),
      size = box.getSize(new THREE.Vector3());
    return {
      height: size.y,
      minY: box.min.y,
      url: asset.url,
      ball: ball.ballStatus,
      clonesDistinct: asset.root.clone(true) !== asset.root,
    };
  });
  expect(model.height).toBeCloseTo(1.7, 2);
  expect(model.minY).toBeCloseTo(0, 2);
  expect(model.url).toContain("MrTreb.glb");
  expect(model.clonesDistinct).toBe(true);
  expect(model.ball).toBe("cannonball.glb");
});
