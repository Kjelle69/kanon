import { test, expect } from "@playwright/test";

test("real video, central simulation, concurrent controls, teardown and rematch", async ({
  browser,
}) => {
  const hostContext = await browser.newContext(),
    guestContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  const errors = [];
  for (const page of [host, guest]) {
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__peers = [];
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(...args) {
          super(...args);
          window.__peers.push(this);
        }
      };
    });
  }
  const snapshot = (page) => page.evaluate(() => window.KanonGame.snapshot());
  async function match(h, g) {
    await h.locator("#create").click();
    await expect(h.locator("#status")).toContainText(/Matchkod: \d{6}/);
    const code = (await h.locator("#status").textContent()).match(/\d{6}/)[0];
    await g.locator("#code").fill(code);
    await g.locator("#join button").click();
    await expect(h.locator("#channelState")).toHaveText("Öppen", {
      timeout: 45000,
    });
    await expect(g.locator("#channelState")).toHaveText("Öppen", {
      timeout: 45000,
    });
    await expect
      .poll(
        () =>
          g.evaluate(() => {
            const v = document.querySelector("#remote");
            return (
              v.videoWidth === 640 && v.videoHeight === 480 && v.currentTime > 0
            );
          }),
        { timeout: 45000 },
      )
      .toBe(true);
    expect((await snapshot(h)).hasSimulation).toBe(true);
    expect((await snapshot(g)).hasSimulation).toBe(false);
    expect((await snapshot(h)).renderSize).toEqual([640, 480, 640, 480]);
    expect(
      await h.evaluate(
        () =>
          window.__peers.filter((p) => p.connectionState !== "closed").length,
      ),
    ).toBe(1);
    expect(
      await g.evaluate(
        () =>
          window.__peers.filter((p) => p.connectionState !== "closed").length,
      ),
    ).toBe(1);
  }
  try {
    await Promise.all([host.goto("/"), guest.goto("/")]);
    await match(host, guest);
    // Both players choose independent ammunition and aim concurrently.
    await host.locator("#lightBtn").click();
    await guest.locator("#heavyBtn").click();
    await expect
      .poll(async () => (await snapshot(host)).ammo)
      .toEqual(["light", "heavy"]);
    // Dispatch in both pages without switching OS focus or causing blur release.
    await Promise.all([
      host.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "d" })),
      ),
      guest.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })),
      ),
    ]);
    await expect
      .poll(async () => (await snapshot(host)).aim[0].yaw)
      .toBeGreaterThan(0.13);
    await expect
      .poll(async () => (await snapshot(host)).aim[1].up)
      .toBeGreaterThan(0.27);
    await Promise.all([
      host.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "d" })),
      ),
      guest.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })),
      ),
    ]);
    await Promise.all([
      host.locator("#fireBtn").click(),
      guest.locator("#fireBtn").click(),
    ]);
    await expect
      .poll(async () => (await snapshot(host)).shots.every((t) => t > 0))
      .toBe(true);
    await expect
      .poll(
        async () => (await snapshot(host)).destroyed.reduce((a, b) => a + b, 0),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    expect((await snapshot(host)).fragments).toBeGreaterThan(0);
    const visibleVideo = await guest.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d");
      ctx.drawImage(document.querySelector("#remote"), 0, 0);
      const pixels = ctx.getImageData(0, 0, 640, 480).data;
      return pixels.some((v, i) => i % 4 !== 3 && v > 20);
    });
    expect(visibleVideo).toBe(true);
    await host.screenshot({ path: "test-results/host.png" });
    await guest.screenshot({ path: "test-results/guest.png" });
    // Malformed commands and diagnostic stress must never enter the host simulation.
    await guest.evaluate(() => {
      window.KanonLobby.sendInput({ type: "ammo", ammo: "invalid" });
      window.KanonLobby.sendInput({
        type: "key",
        key: "__proto__",
        down: true,
      });
      window.KanonLobby.sendInput({ type: "stress" });
    });
    expect((await snapshot(host)).ammo).toEqual(["light", "heavy"]);
    // A phone guest steers the real host through touch + DataChannel.
    const touch = guest.locator('[data-key="d"]');
    await touch.scrollIntoViewIfNeeded();
    const box = await touch.boundingBox();
    const touchSession = await guestContext.newCDPSession(guest);
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await expect
      .poll(async () => (await snapshot(host)).keys["g:d"])
      .toBe(true);
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await snapshot(host)).keys["g:d"])
      .toBe(false);
    // Held guest keys are released on loss of focus.
    await guest.evaluate(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })),
    );
    await expect
      .poll(async () => (await snapshot(host)).keys["g:a"])
      .toBe(true);
    await host.evaluate(() => window.dispatchEvent(new Event("blur")));
    expect((await snapshot(host)).keys["g:a"]).toBe(true);
    await guest.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect
      .poll(async () => (await snapshot(host)).keys["g:a"])
      .toBe(false);
    const videoStats = await guest.evaluate(async () => {
      const reports = await window.__peers[0].getStats();
      return [...reports.values()]
        .filter((r) => r.type === "inbound-rtp" && r.kind === "video")
        .map((r) => ({
          bytesReceived: r.bytesReceived,
          framesDecoded: r.framesDecoded,
        }));
    });
    expect(
      videoStats.some((r) => r.bytesReceived > 0 && r.framesDecoded > 0),
    ).toBe(true);
    await guest.locator("#leave").click();
    await expect(host.locator("#create")).toBeEnabled();
    await expect(guest.locator("#create")).toBeEnabled();
    for (const page of [host, guest]) {
      expect((await snapshot(page)).hasSimulation).toBe(false);
      expect(
        await page.evaluate(() =>
          window.__peers.every((p) => p.connectionState === "closed"),
        ),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.querySelector("#remote").srcObject),
      ).toBe(null);
    }
    // Same pages, reversed roles: new simulation, new stream and no stale callbacks.
    await match(guest, host);
    expect((await snapshot(guest)).ammo).toEqual(["heavy", "heavy"]);
    // Abrupt peer disappearance also permits another match without reloading survivor.
    await host.close();
    await expect(guest.locator("#create")).toBeEnabled({ timeout: 15000 });
    expect((await snapshot(guest)).hasSimulation).toBe(false);
    await guest.locator("#create").click();
    await expect(guest.locator("#status")).toContainText("Matchkod:");
    await guest.locator("#leave").click();
    await expect(guest.locator("#create")).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("original manual signaling remains available only in diagnostic page", async ({
  browser,
}) => {
  const hContext = await browser.newContext(),
    gContext = await browser.newContext();
  const h = await hContext.newPage(),
    g = await gContext.newPage();
  const errors = [];
  for (const p of [h, g]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await Promise.all([
      h.goto("/game/diagnostic.html"),
      g.goto("/game/diagnostic.html"),
    ]);
    await h.locator("#makeOfferBtn").click();
    await expect(h.locator("#localSignal")).not.toHaveValue("", {
      timeout: 30000,
    });
    const offer = await h.locator("#localSignal").inputValue();
    await g.locator("#remoteSignal").fill(offer);
    await g.locator("#applyBtn").click();
    await expect(g.locator("#localSignal")).not.toHaveValue("", {
      timeout: 30000,
    });
    await h
      .locator("#remoteSignal")
      .fill(await g.locator("#localSignal").inputValue());
    await h.locator("#applyBtn").click();
    await expect
      .poll(
        () =>
          g.evaluate(() => document.querySelector("#guestVideo").videoWidth),
        { timeout: 30000 },
      )
      .toBe(640);
    await expect(h.locator("#status")).toContainText("styrkanal ansluten", {
      timeout: 30000,
    });
    await g.locator("#lightBtn").click();
    await expect(h.locator("#stats")).toContainText("light (gäst)", {
      timeout: 15000,
    });
    expect(errors).toEqual([]);
  } finally {
    await hContext.close();
    await gContext.close();
  }
});
