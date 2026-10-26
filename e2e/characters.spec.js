import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
async function prepare(browser, mobile = false) {
  const hc = await browser.newContext({ permissions: ["microphone"] }),
    gc = await browser.newContext({
      permissions: ["microphone"],
      ...(mobile
        ? {
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
          }
        : {}),
    });
  const host = await hc.newPage(),
    guest = await gc.newPage(),
    errors = [];
  for (const p of [host, guest]) {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(() => {
      window.__peers = [];
      const O = RTCPeerConnection;
      window.RTCPeerConnection = class extends O {
        constructor(...args) {
          super(...args);
          window.__peers.push(this);
        }
      };
    });
  }
  // Inject a fixture handle into the host module only. No production debug API.
  await host.route("**/game/scene.js", async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(
      "    this.render();",
      "    window.__testScene=this; this.render();",
    );
    await route.fulfill({ response: r, body });
  });
  await Promise.all([host.goto("/"), guest.goto("/")]);
  await host.locator("#create").click();
  await expect(host.locator("#status")).toContainText(/Matchkod: \d{6}/);
  const code = (await host.locator("#status").textContent()).match(/\d{6}/)[0];
  await guest.locator("#code").fill(code);
  await guest.locator("#join button").click();
  await expect(guest.locator("#channelState")).toHaveText("Öppen", {
    timeout: 45000,
  });
  await expect
    .poll(
      () =>
        guest
          .locator("#remote")
          .evaluate(
            (v) => v.videoWidth === 640 && v.currentTime > 0 && !v.paused,
          ),
      { timeout: 45000 },
    )
    .toBe(true);
  return { host, guest, hc, gc, errors };
}
test("v0.5 independent characters, pointer lock, authoritative damage, audio, PTT and rematch", async ({
  browser,
}) => {
  const { host, guest, hc, gc, errors } = await prepare(browser);
  host.setDefaultTimeout(15000);
  guest.setDefaultTimeout(15000);
  const snap = (p) => p.evaluate(() => window.KanonGame.snapshot());
  try {
    await expect
      .poll(async () => (await snap(host)).characterModel, { timeout: 20000 })
      .toContain("MrTreb.glb");
    expect((await snap(host)).characters.players.map((p) => p.hp)).toEqual([
      100, 100,
    ]);
    await expect
      .poll(() => guest.locator("#hpText1").textContent())
      .toBe("100 HP");
    expect((await snap(guest)).hasSimulation).toBe(false);
    expect(
      await host.evaluate(() => {
        const sections =
          window.__peers[0].localDescription.sdp.split(/\r\n(?=m=)/);
        const id = (kind) =>
          sections
            .find((s) => s.startsWith("m=" + kind))
            ?.match(/a=msid:([^\s]+)/)?.[1];
        return !!id("video") && !!id("audio") && id("video") !== id("audio");
      }),
    ).toBe(true);

    await host.evaluate(() => {
      window.__visibility = [];
      const g = window.__testScene;
      g.renderers.forEach((r, i) => {
        const original = r.render.bind(r);
        r.render = (...args) => {
          window.__visibility[i] =
            !g.characterModels[i].visible && g.characterModels[1 - i].visible;
          return original(...args);
        };
      });
    });
    await expect
      .poll(() => host.evaluate(() => window.__visibility))
      .toEqual([true, true]);
    // Fire while on foot must never create a projectile, even via direct DataChannel input.
    await guest.evaluate(() => window.KanonLobby.sendInput({ type: "fire" }));
    expect((await snap(host)).effects.shots).toBe(0);
    const start = (await snap(host)).characters.players.map((p) => p.position);
    // Keyboard events in both sessions reach independent host-side bodies.
    await Promise.all([
      host.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" })),
      ),
      guest.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" })),
      ),
    ]);
    await expect
      .poll(async () =>
        Math.abs(
          (await snap(host)).characters.players[0].position.x - start[0].x,
        ),
      )
      .toBeGreaterThan(0.2);
    await expect
      .poll(async () =>
        Math.abs(
          (await snap(host)).characters.players[1].position.x - start[1].x,
        ),
      )
      .toBeGreaterThan(0.2);
    await Promise.all([
      host.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "s" })),
      ),
      guest.evaluate(() =>
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "s" })),
      ),
    ]);
    // Real pointer lock and mouse input on the guest; no second simulation or PC.
    const yaw = (await snap(host)).characters.players[1].yaw;
    await guest.locator("#remote").click();
    await expect
      .poll(() => guest.evaluate(() => document.pointerLockElement?.id))
      .toBe("remote");
    await guest.mouse.move(250, 180);
    await guest.mouse.move(340, 200);
    await expect
      .poll(async () =>
        Math.abs((await snap(host)).characters.players[1].yaw - yaw),
      )
      .toBeGreaterThan(0.02);
    await guest.keyboard.press("Escape");
    await expect
      .poll(() => guest.evaluate(() => document.pointerLockElement?.id ?? null))
      .toBe(null);
    // Move fixture bodies back to the operators to isolate proximity interaction.
    await host.evaluate(() => {
      for (const p of window.__testScene.characters.players)
        p.body.position.set(p.id === 0 ? -20.2 : 20.2, 0.86, 1.8);
    });
    await host.locator("#interactBtn").click();
    await guest.locator("#interactBtn").click();
    await expect
      .poll(async () =>
        (await snap(host)).characters.players.map((p) => p.mounted),
      )
      .toEqual([true, true]);
    await expect(guest.locator("#fireBtn")).toBeEnabled();
    await guest.locator("#lightBtn").click();
    await guest.locator("#fireBtn").click();
    await expect.poll(async () => (await snap(host)).effects.shots).toBe(1);
    await guest.locator("#interactBtn").click();
    await expect
      .poll(async () => (await snap(host)).characters.players[1].mounted)
      .toBe(false);
    await guest.locator("#soundBtn").click();
    await host.locator("#soundBtn").click();
    await expect
      .poll(async () => (await snap(host)).audio.state)
      .toBe("running");
    // Reserve voice before permission, then replaceTrack after explicit enable.
    await host.locator("#micBtn").click();
    await guest.locator("#micBtn").click();
    await expect.poll(async () => (await snap(host)).voice.enabled).toBe(true);
    await expect.poll(async () => (await snap(guest)).voice.enabled).toBe(true);
    await guest.locator("#remote").focus();
    await guest.keyboard.down("v");
    await guest.keyboard.down("s");
    await expect.poll(async () => (await snap(guest)).voice.talking).toBe(true);
    await expect
      .poll(async () => (await snap(host)).characters.players[1].position.x)
      .toBeGreaterThan(21.3);
    await expect
      .poll(() =>
        host.evaluate(async () => {
          const p = window.__peers[0],
            a = p
              .getTransceivers()
              .filter((t) => t.receiver.track.kind === "audio")
              .at(-1);
          const stats = await a.receiver.getStats();
          return [...stats.values()].some(
            (r) =>
              r.type === "inbound-rtp" &&
              r.bytesReceived > 0 &&
              r.totalAudioEnergy > 0,
          );
        }),
      )
      .toBe(true);
    await guest.keyboard.up("v");
    await guest.keyboard.up("s");
    await expect
      .poll(async () => (await snap(guest)).voice.talking)
      .toBe(false);
    await host.locator("#hostCanvas").focus();
    await host.keyboard.down("v");
    await expect
      .poll(() =>
        guest.evaluate(async () => {
          const p = window.__peers[0],
            a = p
              .getTransceivers()
              .filter((t) => t.receiver.track.kind === "audio")
              .at(-1);
          const stats = await a.receiver.getStats();
          return [...stats.values()].some(
            (r) => r.type === "inbound-rtp" && r.totalAudioEnergy > 0,
          );
        }),
      )
      .toBe(true);
    await host.keyboard.up("v");
    await expect
      .poll(() =>
        guest.evaluate(async () => {
          const p = window.__peers[0],
            a = p
              .getTransceivers()
              .filter((t) => t.receiver.track.kind === "audio")[0];
          const stats = await a.receiver.getStats();
          return [...stats.values()].some(
            (r) => r.type === "inbound-rtp" && r.totalAudioEnergy > 0,
          );
        }),
      )
      .toBe(true);
    const listeners = (await snap(host)).audio.listeners,
      players = (await snap(host)).characters.players;
    expect(listeners[1].position.x).toBeCloseTo(players[1].eye.x, 1);

    // A deterministic high-speed shot hits the real enemy capsule for exactly 50.
    await host.evaluate(() => {
      const g = window.__testScene,
        p = g.characters.players[1];
      p.body.position.set(23, 0.86, 0);
      g.physics.shoot({
        position: { x: 21.9, y: 0.86, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        speed: 600,
        owner: 0,
      });
    });
    await expect
      .poll(() => guest.locator("#hpText1").textContent())
      .toBe("50 HP");
    expect((await snap(host)).characters.players[1].hp).toBe(50);
    await host.evaluate(() => {
      const g = window.__testScene;
      g.physics.shoot({
        position: { x: 21.9, y: 0.86, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        speed: 600,
        owner: 0,
      });
    });
    await expect(guest.locator("#matchEnd")).toBeVisible();
    await expect(guest.locator("#winnerText")).toHaveText("Spelare 1 vann");
    await expect(guest.locator("#fireBtn")).toBeDisabled();
    // Result updates must not repeatedly release postgame PTT or reenable gameplay.
    await host.locator("#hostCanvas").focus();
    await host.keyboard.down("v");
    await host.waitForTimeout(350);
    expect((await snap(host)).voice.talking).toBe(true);
    await host.keyboard.up("v");
    for (const page of [host, guest])
      expect(await page.evaluate(() => window.__peers.length)).toBe(1);
    await expect
      .poll(() => host.evaluate(() => window.__testScene.shake[1]))
      .toBeLessThan(0.005);
    await writeFile(
      "test-results/v05-performance.json",
      JSON.stringify(await snap(host), null, 2),
    );
    await host
      .locator("#hostCanvas")
      .screenshot({ path: "test-results/v05-host.png" });
    await guest.locator("#newMatchBtn").click();
    await expect(host.locator("#create")).toBeEnabled();
    expect((await snap(host)).voice.enabled).toBe(false);
    expect((await snap(guest)).voice.enabled).toBe(false);
    await host.locator("#create").click();
    await expect
      .poll(async () => (await snap(host)).characters?.players.map((p) => p.hp))
      .toEqual([100, 100]);
    await host.locator("#leave").click();
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await gc.close();
  }
});

test("mobile guest joystick and touch look use bounded motion packets; microphone denial is nonfatal", async ({
  browser,
}) => {
  const { host, guest, hc, gc, errors } = await prepare(browser, true);
  try {
    const start = await host.evaluate(
      () => window.KanonGame.snapshot().characters.players[1],
    );
    const stick = guest.locator("#joystick");
    await stick.scrollIntoViewIfNeeded();
    const r = await stick.boundingBox(),
      cdp = await gc.newCDPSession(guest);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height * 0.15 }],
    });
    await expect
      .poll(() =>
        host.evaluate(
          () => window.KanonGame.snapshot().characters.players[1].position.x,
        ),
      )
      .toBeLessThan(start.position.x - 0.2);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(() =>
        host.evaluate(() => window.__testScene.characters.players[1].axes.z),
      )
      .toBe(0);
    const yaw = await host.evaluate(
      () => window.KanonGame.snapshot().characters.players[1].yaw,
    );
    const pad = guest.locator("#lookPad");
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + 30, y: box.y + 50 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x + 100, y: box.y + 30 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() =>
        host.evaluate(
          () => window.KanonGame.snapshot().characters.players[1].yaw,
        ),
      )
      .not.toBe(yaw);
    // Coalesce a burst during an active, captured look gesture.
    await guest.evaluate(() => {
      window.__motions = 0;
      window.__motionStart = performance.now();
      const old = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (data) {
        if (JSON.parse(data).type === "motion") window.__motions++;
        return old.call(this, data);
      };
      document
        .querySelector("#lookPad")
        .addEventListener(
          "pointerdown",
          (e) => (window.__lookId = e.pointerId),
        );
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + 30, y: box.y + 50 }],
    });
    await guest.evaluate(() => {
      const p = document.querySelector("#lookPad"),
        r = p.getBoundingClientRect();
      for (let i = 0; i < 500; i++)
        p.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerId: window.__lookId,
            clientX: r.x + 30 + (i % 60),
            clientY: r.y + 40,
          }),
        );
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(await guest.evaluate(() => window.__motions)).toBeLessThanOrEqual(
      await guest.evaluate(
        () => Math.ceil((performance.now() - window.__motionStart) / 40) + 3,
      ),
    );
    await guest.evaluate(() => {
      window.__gumCalls = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.__gumCalls++;
        throw new DOMException("denied", "NotAllowedError");
      };
    });
    await guest.locator("#micBtn").tap();
    await expect(guest.locator("#voiceState")).toContainText("nekades");
    expect(await guest.evaluate(() => window.__gumCalls)).toBe(1);
    await expect(guest.locator("#channelState")).toHaveText("Öppen");
    await guest.locator("#interactBtn").tap();
    await expect(guest.locator("#fireBtn")).toBeEnabled();
    // Two fingers: continue aiming on the joystick while tapping Fire.
    await guest.locator("#remote").scrollIntoViewIfNeeded();
    await guest.locator("#fireBtn").scrollIntoViewIfNeeded();
    const sr = await stick.boundingBox(),
      fr = await guest.locator("#fireBtn").boundingBox();
    const finger = {
      id: 11,
      x: sr.x + sr.width / 2,
      y: sr.y + sr.height * 0.15,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [finger],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        finger,
        { id: 22, x: fr.x + fr.width / 2, y: fr.y + fr.height / 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() =>
        host.evaluate(() => window.KanonGame.snapshot().effects.shots),
      )
      .toBe(1);
    await guest
      .locator("#viewport")
      .screenshot({ path: "test-results/v05-mobile.png" });
    await guest.locator("#leave").tap();
    await expect(host.locator("#create")).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await gc.close();
  }
});

test("a microphone replaceTrack resolving after leaving cannot reactivate microphone UI", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#create").click();
  await expect(page.locator("#interactBtn")).toBeEnabled();
  await page.evaluate(async () => {
    const { voice } = await import("/game/voice.js");
    const context = new AudioContext(),
      destination = context.createMediaStreamDestination();
    window.__lateContext = context;
    window.__lateTrack = destination.stream.getAudioTracks()[0];
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    voice.attach({
      replaceTrack(track) {
        if (track)
          return new Promise((resolve) => (window.__resolveReplace = resolve));
        return Promise.resolve();
      },
    });
  });
  await page.locator("#micBtn").click();
  await expect
    .poll(() => page.evaluate(() => typeof window.__resolveReplace))
    .toBe("function");
  await page.locator("#leave").click();
  await expect(page.locator("#create")).toBeEnabled();
  await page.evaluate(() => window.__resolveReplace());
  await expect(page.locator("#micBtn")).toHaveText("Aktivera mikrofon");
  await expect(page.locator("#voiceState")).toHaveText("Mikrofon av");
  expect(await page.evaluate(() => window.__lateTrack.readyState)).toBe(
    "ended",
  );
  await page.evaluate(() => window.__lateContext.close());
});
