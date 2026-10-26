import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("v0.4 host: muzzle, recoil, enemy breach, rigid rubble, fire and cosmetic budget", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#create").click();
  await expect(page.locator("#interactBtn")).toBeEnabled();
  await page.locator("#interactBtn").click();
  // Solo regression fixture: enable combat without a second browser.
  await page.evaluate(() => window.KanonGame.onReady());
  const snap = () => page.evaluate(() => window.KanonGame.snapshot());
  await expect
    .poll(
      async () => (await snap()).models?.every((m) => m.model === "cannon.glb"),
      { timeout: 20000 },
    )
    .toBe(true);
  expect((await snap()).models.map((m) => m.parts)).toEqual([7, 7]);
  expect((await snap()).physics.detached).toBe(0);
  await page
    .locator("#hostCanvas")
    .screenshot({ path: "test-results/v04-cannon-view.png" });
  await page.locator("#fireBtn").click();
  await expect.poll(async () => (await snap()).effects.shots).toBe(1);
  const fired = await snap();
  expect(fired.muzzles[0].model).toBe("cannon.glb");
  expect(fired.muzzles[0].position[0]).toBeGreaterThan(-17);
  expect(fired.muzzles[0].position[0]).toBeLessThan(-14);
  expect(fired.muzzles[0].direction[0]).toBeGreaterThan(0.9);
  expect(fired.muzzles[0].direction[1]).toBeGreaterThan(0.1);
  expect(fired.recoil[0]).toBeGreaterThan(0);
  await expect
    .poll(async () => (await snap()).effects.active)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await snap()).effects.hits, { timeout: 30000 })
    .toBeGreaterThan(0);
  const hit = await snap();
  expect(hit.lastImpact.owner).toBe(1);
  expect(hit.lastImpact.energy).toBeGreaterThan(40000);
  await expect
    .poll(async () => (await snap()).physics.movedBlocks, { timeout: 30000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await snap()).physics.fallenBlocks, { timeout: 30000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await snap()).physics.sleeping, { timeout: 30000 })
    .toBeGreaterThan(0);
  expect((await snap()).physics.brokenBonds).toBeGreaterThan(0);
  await page.locator("#diagnostics summary").click();
  await page.locator("#igniteBtn").click();
  await expect.poll(async () => (await snap()).effects.fires).toBe(2);
  const normal = await snap();
  const stoneDamageBefore = normal.physics.detached;
  // Stress is entirely cosmetic: no additional rigid bodies or damage.
  await page.locator("#stressBtn").click();
  await expect
    .poll(async () => (await snap()).fragments)
    .toBeGreaterThan(15000);
  const stress = await snap();
  expect(stress.fragments).toBeLessThanOrEqual(20000);
  expect(stress.fragments).toBeGreaterThan(15000);
  expect(stress.physics.detached).toBe(stoneDamageBefore);
  expect(stress.effects.active).toBeLessThanOrEqual(2400);
  await page.waitForTimeout(2000);
  const stressMeasured = await snap();
  await writeFile(
    "test-results/performance-v04.json",
    JSON.stringify({ normal, stress: stressMeasured }, null, 2),
  );
  await page.screenshot({ path: "test-results/v04-host.png" });
  await page.locator("#leave").click();
  await expect(page.locator("#create")).toBeEnabled();
  expect((await snap()).hasSimulation).toBe(false);
  expect(errors).toEqual([]);
});

test("touch controls work in a phone-sized browser and release on pointer cancellation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.locator("#create").click();
    await expect(page.locator("#interactBtn")).toBeEnabled();
    await page.locator("#interactBtn").click();
    // Solo regression fixture: enable combat without a second browser.
    await page.evaluate(() => window.KanonGame.onReady());
    await page.locator('[data-key="d"]').scrollIntoViewIfNeeded();
    const b = await page.locator('[data-key="d"]').boundingBox();
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
    });
    await expect
      .poll(() => page.evaluate(() => window.KanonGame.snapshot().aim[0].yaw))
      .toBeGreaterThan(0.13);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => !!window.KanonGame.snapshot().keys.d))
      .toBe(false);
    await page.locator("#fireBtn").tap();
    await expect
      .poll(() =>
        page.evaluate(() => window.KanonGame.snapshot().effects.shots),
      )
      .toBe(1);
    await page.locator("#leave").tap();
    await expect(page.locator("#create")).toBeEnabled();
  } finally {
    await context.close();
  }
});
