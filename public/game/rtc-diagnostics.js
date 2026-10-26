const finite = (v) => (Number.isFinite(v) ? v : null);
export function difference(now, previous, key) {
  return Number.isFinite(now?.[key]) && Number.isFinite(previous?.[key])
    ? key === "packetsLost" || now[key] >= previous[key]
      ? now[key] - previous[key]
      : null
    : null;
}
export function meanDelta(now, previous, total, count) {
  const n = difference(now, previous, count),
    d = difference(now, previous, total);
  return n > 0 && d !== null ? (1000 * d) / n : null;
}
export class RtcDiagnostics {
  constructor(pc, video, role, channel, onSample = () => {}) {
    this.pc = pc;
    this.video = video;
    this.role = role;
    this.channel = channel;
    this.onSample = onSample;
    this.history = [];
    this.previous = new Map();
    this.presented = 0;
    this.started = performance.now();
    this.lastPresented = 0;
    this.lastTime = this.started;
    this.alive = true;
    this.ping = 0;
    this.rtt = null;
    if (role === "guest" && video.requestVideoFrameCallback) {
      const frame = (now, m) => {
        if (!this.alive) return;
        if (this.basePresented === undefined)
          this.basePresented = m.presentedFrames;
        this.presented = Number.isFinite(m.presentedFrames)
          ? m.presentedFrames - this.basePresented + 1
          : this.presented + 1;
        this.frame = {
          mediaTime: m.mediaTime,
          processingMs: finite(m.processingDuration * 1000),
          captureAgeMs: finite(now - m.captureTime),
          receiveAgeMs: finite(now - m.receiveTime),
        };
        this.frameId = video.requestVideoFrameCallback(frame);
      };
      this.frameId = video.requestVideoFrameCallback(frame);
    }
    this.timer = setInterval(() => this.sample(), 2000);
  }
  async sample() {
    if (!this.alive || this.busy) return;
    this.busy = true;
    try {
      const reports = await this.pc.getStats();
      if (!this.alive) return;
      const now = performance.now(),
        seconds = (now - this.lastTime) / 1000;
      const receiver = this.pc
        .getReceivers?.()
        .find((r) => r.track.kind === "video");
      const row = {
        visibility:
          typeof document === "undefined" ? null : document.visibilityState,
        receiverTarget:
          receiver && "jitterBufferTarget" in receiver
            ? receiver.jitterBufferTarget
            : null,
        seconds: (now - this.started) / 1000,
        role: this.role,
        presentedFps:
          this.role === "guest" && this.video.requestVideoFrameCallback
            ? (this.presented - this.lastPresented) / seconds
            : null,
        paused: this.video.paused,
        readyState: this.video.readyState,
        currentTime: this.video.currentTime,
        dataRttMs: this.rtt,
        bufferedBytes: this.channel()?.bufferedAmount ?? null,
        frame: this.frame,
      };
      for (const r of reports.values()) {
        const previous = this.previous.get(r.id);
        if (
          r.kind === "video" &&
          r.type === (this.role === "host" ? "outbound-rtp" : "inbound-rtp")
        ) {
          row.statsId = r.id;
          row.cumulative = {};
          row.delta = {};
          for (const k of [
            "framesSent",
            "framesEncoded",
            "totalEncodeTime",
            "framesReceived",
            "framesDecoded",
            "framesDropped",
            "freezeCount",
            "totalDecodeTime",
            "packetsLost",
            "packetsReceived",
            "packetsSent",
            "bytesSent",
            "bytesReceived",
            "jitterBufferDelay",
            "jitterBufferEmittedCount",
            "jitterBufferTargetDelay",
            "jitterBufferMinimumDelay",
            "totalProcessingDelay",
          ]) {
            row.cumulative[k] = finite(r[k]);
            row.delta[k] = difference(r, previous, k);
          }
          row.encoderFps =
            row.delta.framesEncoded === null
              ? null
              : row.delta.framesEncoded / seconds;
          row.decoderFps =
            row.delta.framesDecoded === null
              ? null
              : row.delta.framesDecoded / seconds;
          row.encodeMs = meanDelta(
            r,
            previous,
            "totalEncodeTime",
            "framesEncoded",
          );
          row.decodeMs = meanDelta(
            r,
            previous,
            "totalDecodeTime",
            "framesDecoded",
          );
          row.jitterMs = meanDelta(
            r,
            previous,
            "jitterBufferDelay",
            "jitterBufferEmittedCount",
          );
          row.targetJitterMs = meanDelta(
            r,
            previous,
            "jitterBufferTargetDelay",
            "jitterBufferEmittedCount",
          );
          row.minimumJitterMs = meanDelta(
            r,
            previous,
            "jitterBufferMinimumDelay",
            "jitterBufferEmittedCount",
          );
          row.reportedFps = finite(r.framesPerSecond);
          row.jitter = finite(r.jitter * 1000);
          row.qualityLimitation = r.qualityLimitationReason ?? null;
          const bytes = row.delta.bytesSent ?? row.delta.bytesReceived;
          row.bitrateKbps =
            bytes === null ? null : (bytes * 8) / seconds / 1000;
          const received = row.delta.packetsReceived,
            lost = row.delta.packetsLost;
          row.lossPercent =
            received !== null && lost !== null && received + lost > 0
              ? (100 * Math.max(0, lost)) / (received + lost)
              : null;
          row.renderDelayMs = meanDelta(
            r,
            previous,
            "totalProcessingDelay",
            "framesDecoded",
          );
        }
        if (r.type === "transport" && r.selectedCandidatePairId) {
          const pair = reports.get(r.selectedCandidatePairId);
          row.rttMs = finite(pair?.currentRoundTripTime * 1000);
        }
        if (r.type === "remote-inbound-rtp" && r.kind === "video") {
          row.remoteLossCumulative = finite(r.packetsLost);
          row.remoteLoss = difference(r, previous, "packetsLost");
        }
      }
      this.previous = new Map(reports);
      this.lastTime = now;
      this.lastPresented = this.presented;
      this.history.push(row);
      if (this.history.length > 180) this.history.shift();
      this.onSample(row, this.history);
      const c = this.channel();
      if (c?.readyState === "open" && c.bufferedAmount < 2048) {
        this.ping = now;
        c.send(JSON.stringify({ type: "diag-ping", time: now }));
      }
    } catch {
      /* A closing PC can invalidate a pending stats read. */
    } finally {
      this.busy = false;
    }
  }
  message(m) {
    const c = this.channel();
    if (m.type === "diag-ping") {
      if (c?.readyState === "open" && c.bufferedAmount < 2048)
        c.send(JSON.stringify({ type: "diag-pong", time: m.time }));
      return true;
    }
    if (m.type === "diag-pong") {
      if (m.time === this.ping) this.rtt = performance.now() - m.time;
      return true;
    }
    return false;
  }
  dispose() {
    this.alive = false;
    clearInterval(this.timer);
    if (this.frameId !== undefined)
      this.video.cancelVideoFrameCallback?.(this.frameId);
    this.previous.clear();
  }
}
export function renderDiagnostics(row, history) {
  const f = (v, n = 1) => (v === null || v === undefined ? "–" : v.toFixed(n));
  const panel = document.querySelector("#rtcStats");
  if (!panel) return;
  panel.textContent = `${row.role} · ${f(row.seconds, 0)} s · ${history.length}/180 prover (6 min)\nFPS kodad/avkodad/presenterad: ${f(row.encoderFps)}/${f(row.decoderFps)}/${f(row.presentedFps)}\nKodning/avkodning: ${f(row.encodeMs)}/${f(row.decodeMs)} ms/bild · jitterbuffert ${f(row.jitterMs)} ms · mål ${f(row.targetJitterMs)} ms · min ${f(row.minimumJitterMs)} ms\nRTT nät/data: ${f(row.rttMs)}/${f(row.dataRttMs)} ms · ${f(row.bitrateKbps, 0)} kbit/s · förlust ${f(row.lossPercent)} %\nΔ skickade/kodade/mottagna/avkodade/tappade/frysningar: ${["framesSent", "framesEncoded", "framesReceived", "framesDecoded", "framesDropped", "freezeCount"].map((k) => row.delta?.[k] ?? "–").join("/")}\nBildålder RTCP-estimat ${f(row.frame?.captureAgeMs)} ms\nVideo ${row.visibility ?? "–"} paus=${row.paused} ready=${row.readyState} tid=${f(row.currentTime)} s · kanal-kö ${row.bufferedBytes} byte · native FPS ${f(row.reportedFps)} · begränsning ${row.qualityLimitation ?? "–"}`;
  const historyPanel = document.querySelector("#rtcHistory");
  if (historyPanel)
    historyPanel.textContent =
      "tid s | FPS presenterad/avkodad | jitter ms | data-RTT ms\n" +
      history
        .map(
          (r) =>
            `${f(r.seconds, 0)} | ${f(r.presentedFps)}/${f(r.decoderFps)} | ${f(r.jitterMs)} | ${f(r.dataRttMs)}`,
        )
        .join("\n");
}
