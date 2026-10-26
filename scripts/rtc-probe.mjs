import { chromium } from "@playwright/test";
import { createLobby } from "../server.js";
import { mkdir, writeFile } from "node:fs/promises";
const port = 8092,
  url = `http://127.0.0.1:${port}`,
  lobby = createLobby({ origins: [url] }),
  out = process.env.RTC_REPORT || "/tmp/kanon-rtc-baseline.json";
await new Promise((r) => lobby.server.listen(port, "127.0.0.1", r));
const args = [
  "--no-sandbox",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--autoplay-policy=no-user-gesture-required",
];
const a = await chromium.launch({ executablePath: "/usr/bin/chromium", args }),
  b = await chromium.launch({ executablePath: "/usr/bin/chromium", args });
const host = await a.newPage(),
  guest = await b.newPage(),
  errors = [],
  results = [];
for (const p of [host, guest]) {
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => {
    window.__pcs = [];
    window.__streams = [];
    const PC = RTCPeerConnection;
    window.RTCPeerConnection = class extends PC {
      constructor(...args) {
        super(...args);
        window.__pcs.push(this);
      }
    };
    const capture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (rate) {
      const s = capture.call(this, window.__fps || rate);
      window.__streams.push(s);
      return s;
    };
    const raf = requestAnimationFrame,
      cancel = cancelAnimationFrame;
    window.__rafs = new Set();
    window.requestAnimationFrame = (fn) => {
      const id = raf((t) => {
        window.__rafs.delete(id);
        fn(t);
      });
      window.__rafs.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      window.__rafs.delete(id);
      cancel(id);
    };
  });
}
await host.route("**/lobby.js", async (route) => {
  const r = await route.fetch();
  await route.fulfill({
    response: r,
    body: (await r.text()).replace(
      /streams:\s*\[s\.gameAudioStream\]/,
      "streams:[window.__shared ? s.stream : s.gameAudioStream]",
    ),
  });
});
await host.route("**/game/scene.js", async (route) => {
  const r = await route.fetch();
  await route.fulfill({
    response: r,
    body: (await r.text()).replace(
      "    this.render();",
      "    window.__scene=this; this.render();",
    ),
  });
});
try {
  await Promise.all([host.goto(url), guest.goto(url)]);
  const cases = process.env.RTC_CASES
    ? JSON.parse(process.env.RTC_CASES)
    : process.env.RTC_SOAK_ONLY
      ? [{ mode: "game", fps: 60, audio: true, duration: 600 }]
      : [
          { mode: "video", fps: 30, audio: false, duration: 24 },
          { mode: "video", fps: 60, audio: false, duration: 24 },
          { mode: "game", fps: 30, audio: false, duration: 24 },
          { mode: "game", fps: 30, audio: true, duration: 24 },
          { mode: "game", fps: 60, audio: false, duration: 24 },
          { mode: "game", fps: 60, audio: true, duration: 600 },
        ];
  for (const spec of cases) {
    await host.evaluate((spec) => {
      window.__fps = spec.fps;
      window.__shared = !!spec.shared;
    }, spec);
    await host.locator("#create").click();
    await host.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("Matchkod:"),
    );
    const code = (await host.locator("#status").textContent()).match(
      /\d{6}/,
    )[0];
    await guest.locator("#code").fill(code);
    await guest.locator("#join button").click();
    await guest.waitForFunction(
      () =>
        document.querySelector("#remote").videoWidth === 640 &&
        document.querySelector("#remote").currentTime > 0,
      {},
      { timeout: 45000 },
    );
    await host.evaluate(async (spec) => {
      const g = window.__scene;
      await g.ready;
      await g.characterReady;
      const THREE = await import("/vendor/three.module.js");
      const empty = new THREE.Scene();
      empty.background = new THREE.Color(0x486f85);
      if (spec.mode === "video") {
        g.physics.advance = () => 0;
        g.effects.update = () => {};
        g.renderers[0].render = () => {};
      }
      const r = g.renderers[1],
        render = r.render.bind(r);
      r.render = (scene, camera) => {
        render(spec.mode === "video" ? empty : scene, camera);
        const stamp = Date.now() >>> 0,
          old = r.getClearColor(new THREE.Color());
        r.setScissorTest(true);
        for (let i = 0; i < 32; i++) {
          r.setScissor(16 + i * 12, 0, 10, 16);
          r.setClearColor((stamp >>> i) & 1 ? 0xffffff : 0x000000);
          r.clear(true, false, false);
        }
        r.setScissorTest(false);
        r.setClearColor(old);
      };
      const audio = window.__pcs
        .at(-1)
        .getSenders()
        .find((s) => s.track?.kind === "audio");
      if (!spec.audio) await audio.replaceTrack(null);
      else g.unlockAudio();
      if (spec.mode === "game") {
        g.interact(0);
        g.fire(0);
      }
    }, spec);
    await guest.evaluate((spec) => {
      window.__hintSupported =
        "jitterBufferTarget" in
        window.__pcs
          .at(-1)
          .getReceivers()
          .find((r) => r.track.kind === "video");
      if (spec.hint !== undefined && window.__hintSupported)
        window.__pcs
          .at(-1)
          .getReceivers()
          .find((r) => r.track.kind === "video").jitterBufferTarget = spec.hint;
      window.__ages = [];
      window.__bad = 0;
      const v = document.querySelector("#remote"),
        c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const frame = () => {
        ctx.drawImage(v, 0, 0, 640, 480);
        const pixels = ctx.getImageData(0, 472, 640, 1).data;
        let stamp = 0;
        for (let i = 0; i < 32; i++)
          if (pixels[(21 + i * 12) * 4] > 128) stamp += 2 ** i;
        let age = (Date.now() >>> 0) - stamp;
        if (age < 0) age += 2 ** 32;
        if (age < 10000) window.__ages.push(age);
        else window.__bad++;
        if (window.__ages.length > 240) window.__ages.shift();
        window.__frame = v.requestVideoFrameCallback(frame);
      };
      window.__frame = v.requestVideoFrameCallback(frame);
    }, spec);
    const row = { ...spec, samples: [] };
    results.push(row);
    const start = Date.now();
    let logged = -1;
    while (Date.now() - start < spec.duration * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const [h, g] = await Promise.all([
        host.evaluate(() => ({
          stats: window.KanonLobby.diagnostics.at(-1),
          pcs: window.__pcs.filter((p) => p.connectionState !== "closed")
            .length,
          streams: window.__streams.filter((s) =>
            s.getVideoTracks().some((t) => t.readyState === "live"),
          ).length,
          rafs: window.__rafs.size,
        })),
        guest.evaluate(() => {
          const ages = window.__ages.splice(0).sort((a, b) => a - b);
          return {
            stats: window.KanonLobby.diagnostics.at(-1),
            pcs: window.__pcs.filter((p) => p.connectionState !== "closed")
              .length,
            ageMedian: ages.length ? ages[Math.floor(ages.length * 0.5)] : null,
            ageP95: ages.length ? ages[Math.floor(ages.length * 0.95)] : null,
            bad: window.__bad,
            hintSupported: window.__hintSupported,
          };
        }),
      ]);
      row.samples.push({
        elapsed: (Date.now() - start) / 1000,
        host: h,
        guest: g,
      });
      const minute = Math.floor((Date.now() - start) / 60000);
      if (minute !== logged) {
        logged = minute;
        console.log(
          JSON.stringify({
            mode: spec.mode,
            fps: spec.fps,
            audio: spec.audio,
            minute,
            age: g.ageMedian,
            jitter: g.stats?.jitterMs,
            decoded: g.stats?.decoderFps,
            dataRtt: g.stats?.dataRttMs,
          }),
        );
        await writeFile(out, JSON.stringify({ results, errors }, null, 2));
      }
    }
    await guest.evaluate(() =>
      document
        .querySelector("#remote")
        .cancelVideoFrameCallback(window.__frame),
    );
    await guest.locator("#leave").click();
    await host.waitForFunction(
      () => !document.querySelector("#create").disabled,
    );
    row.cleanup = await host.evaluate(() => ({
      pcs: window.__pcs.filter((p) => p.connectionState !== "closed").length,
      streams: window.__streams.filter((s) =>
        s.getTracks().some((t) => t.readyState === "live"),
      ).length,
      rafs: window.__rafs.size,
    }));
    await writeFile(out, JSON.stringify({ results, errors }, null, 2));
  }
} finally {
  await a.close();
  await b.close();
  await lobby.close();
}
