import { test } from "node:test";
import assert from "node:assert/strict";
import {
  difference,
  meanDelta,
  RtcDiagnostics,
} from "../public/game/rtc-diagnostics.js";
test("interval averages use differences and preserve missing fields", () => {
  const a = { delay: 8, count: 100 },
    b = { delay: 9, count: 110 };
  assert.equal(meanDelta(b, a, "delay", "count"), 100);
  assert.equal(meanDelta(b, a, "missing", "count"), null);
  assert.equal(meanDelta(a, a, "delay", "count"), null);
  assert.equal(difference(b, a, "count"), 10);
  assert.equal(difference(a, b, "count"), null);
});
test("history is bounded and closed diagnostics never append late stats", async () => {
  let n = 0;
  const pc = {
    getStats: async () =>
      new Map([
        [
          "v",
          {
            id: "v",
            kind: "video",
            type: "outbound-rtp",
            framesEncoded: ++n,
            totalEncodeTime: n * 0.002,
          },
        ],
      ]),
  };
  const d = new RtcDiagnostics(pc, {}, "host", () => null);
  try {
    for (let i = 0; i < 185; i++) await d.sample();
    assert.equal(d.history.length, 180);
    assert.equal(d.history.at(-1).encodeMs.toFixed(1), "2.0");
    d.dispose();
    await d.sample();
    assert.equal(d.history.length, 180);
  } finally {
    d.dispose();
  }
});
test("dispose cancels video callback and ignores an in-flight stats result", async () => {
  let complete, callback, cancelled;
  const pc = { getStats: () => new Promise((r) => (complete = r)) };
  const video = {
    requestVideoFrameCallback(fn) {
      callback = fn;
      return 42;
    },
    cancelVideoFrameCallback(id) {
      cancelled = id;
    },
  };
  const d = new RtcDiagnostics(pc, video, "guest", () => null);
  const pending = d.sample();
  d.dispose();
  complete(new Map());
  await pending;
  callback(1, {});
  assert.equal(cancelled, 42);
  assert.equal(d.history.length, 0);
});
