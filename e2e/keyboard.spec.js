import { test, expect } from "@playwright/test";

test("guest space fires without pausing video; text focus and arrows respect game boundaries", async ({
  browser,
}) => {
  const hc = await browser.newContext(),
    gc = await browser.newContext();
  const host = await hc.newPage(),
    guest = await gc.newPage();
  try {
    await Promise.all([host.goto("/"), guest.goto("/")]);
    await host.locator("#create").click();
    await expect(host.locator("#status")).toContainText(/Matchkod: \d{6}/);
    const code = (await host.locator("#status").textContent()).match(
      /\d{6}/,
    )[0];
    await guest.locator("#code").fill(code);
    await guest.locator("#join button").click();
    await expect(guest.locator("#channelState")).toHaveText("Öppen", {
      timeout: 45000,
    });
    await expect(guest.locator("#interactBtn")).toBeEnabled();
    await guest.locator("#interactBtn").click();
    const video = guest.locator("#remote");
    await expect
      .poll(
        () =>
          video.evaluate(
            (v) => v.videoWidth === 640 && !v.paused && v.currentTime > 0,
          ),
        { timeout: 45000 },
      )
      .toBe(true);
    expect(
      await video.evaluate((v) => ({
        controls: v.controls,
        autoplay: v.autoplay,
        muted: v.muted,
        inline: v.playsInline,
      })),
    ).toEqual({ controls: false, autoplay: true, muted: true, inline: true });
    await guest.evaluate(() => {
      window.pauseCount = 0;
      document
        .querySelector("#remote")
        .addEventListener("pause", () => window.pauseCount++);
      window.commands = [];
      // Observe actual DataChannel sends without replacing the game's adapter.
      const send = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (data) {
        window.commands.push(JSON.parse(data));
        return send.call(this, data);
      };
    });
    await guest.locator("#lightBtn").click();
    await expect
      .poll(() => host.evaluate(() => window.KanonGame.snapshot().ammo[1]))
      .toBe("light");
    await video.click();
    await guest.keyboard.press("Escape");
    await expect(video).toBeFocused();
    const before = await host.evaluate(
      () => window.KanonGame.snapshot().effects.shots,
    );
    const time = await video.evaluate((v) => v.currentTime);
    await guest.keyboard.press("Space");
    await expect
      .poll(() =>
        host.evaluate(() => window.KanonGame.snapshot().effects.shots),
      )
      .toBe(before + 1);
    await expect
      .poll(() => video.evaluate((v) => v.currentTime))
      .toBeGreaterThan(time);
    expect(await video.evaluate((v) => v.paused)).toBe(false);
    // Space also fires while an ammunition button has focus; no native button click.
    await expect
      .poll(() =>
        host.evaluate(
          () => performance.now() / 1000 - window.KanonGame.snapshot().shots[1],
        ),
      )
      .toBeGreaterThan(2);
    await guest.locator("#heavyBtn").focus();
    await guest.keyboard.press("Space");
    await expect
      .poll(() =>
        host.evaluate(() => window.KanonGame.snapshot().effects.shots),
      )
      .toBe(before + 2);
    expect(await host.evaluate(() => window.KanonGame.snapshot().ammo[1])).toBe(
      "light",
    );
    await video.focus();
    const scroll = await guest.evaluate(() => window.scrollY);
    await guest.keyboard.down("ArrowRight");
    await expect
      .poll(() => host.evaluate(() => window.KanonGame.snapshot().keys["g:d"]))
      .toBe(true);
    await guest.keyboard.up("ArrowRight");
    await expect
      .poll(() => host.evaluate(() => window.KanonGame.snapshot().keys["g:d"]))
      .toBe(false);
    expect(await guest.evaluate(() => window.scrollY)).toBe(scroll);
    // Lobby input, textarea, and contenteditable receive their native keys, with no game messages.
    await guest.evaluate(() => {
      const area = document.createElement("textarea");
      area.id = "test-textarea";
      document.body.append(area);
      const editable = document.createElement("div");
      editable.id = "test-editable";
      editable.contentEditable = "true";
      document.body.append(editable);
    });
    for (const selector of ["#code", "#test-textarea", "#test-editable"]) {
      await guest.locator(selector).focus();
      await guest.evaluate(() => (window.commands = []));
      await guest.keyboard.press("Space");
      await guest.keyboard.press("ArrowLeft");
      await guest.keyboard.press("w");
      expect(
        await guest.evaluate(() =>
          window.commands.filter(
            (m) => m.type !== "motion" || m.x || m.z || m.lookX || m.lookY,
          ),
        ),
      ).toEqual([]);
    }
    expect(await guest.evaluate(() => window.pauseCount)).toBe(0);
    expect(await video.evaluate((v) => v.paused)).toBe(false);
    await guest.locator("#leave").click();
    await expect(host.locator("#create")).toBeEnabled();
  } finally {
    await hc.close();
    await gc.close();
  }
});
