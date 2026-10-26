// Two independent virtual listeners. Only the remote perspective is routed to
// the outgoing game-audio track; microphones are never mixed into this bus.
export class SoundMixer {
  constructor() {
    this.context = new AudioContext();
    this.dest = this.context.createMediaStreamDestination();
    this.local = this.context.createGain();
    this.local.gain.value = 0;
    this.local.connect(this.context.destination);
    this.remote = this.context.createGain();
    this.remote.gain.value = 0.6;
    this.remote.connect(this.dest);
    this.listeners = [
      { position: { x: -20, y: 1.55, z: 1.8 }, yaw: 0 },
      { position: { x: 20, y: 1.55, z: 1.8 }, yaw: Math.PI },
    ];
    this.active = [];
    this.enabled = false;
    this.disposed = false;
    this.noise = this.context.createBuffer(
      1,
      this.context.sampleRate,
      this.context.sampleRate,
    );
    const a = this.noise.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
  }
  unlock() {
    if (this.disposed) return;
    this.enabled = true;
    this.local.gain.value = 0.55;
    return this.context.resume().catch(() => {});
  }
  setListeners(listeners) {
    this.listeners = listeners.map((p) => ({
      position: { ...p.position },
      yaw: p.yaw,
    }));
    for (const s of this.active) this.spatial(s);
    this.active = this.active.filter((s) => s.until > this.context.currentTime);
  }
  spatial(s) {
    const p = this.listeners[s.listener],
      dx = s.point.x - p.position.x,
      dz = s.point.z - p.position.z,
      dy = s.point.y - p.position.y,
      d = Math.hypot(dx, dy, dz);
    s.gain.gain.value = s.volume / (1 + d * 0.15);
    s.pan.pan.value = Math.max(
      -1,
      Math.min(
        1,
        (-Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz) / Math.max(1, d),
      ),
    );
  }
  event(kind, point, energy = 1) {
    if (
      this.disposed ||
      this.context.state !== "running" ||
      this.active.length >= 24
    )
      return;
    const duration = kind === "shot" ? 0.8 : 0.35,
      volume = kind === "shot" ? 0.9 : Math.min(0.3, 0.08 + energy / 250000);
    for (let listener = 0; listener < 2; listener++) {
      const source = this.context.createBufferSource();
      source.buffer = this.noise;
      source.playbackRate.value = kind === "shot" ? 0.5 : 1;
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = kind === "shot" ? 550 : 1400;
      const envelope = this.context.createGain(),
        gain = this.context.createGain(),
        pan = this.context.createStereoPanner();
      const now = this.context.currentTime;
      envelope.gain.setValueAtTime(1, now);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
      source
        .connect(filter)
        .connect(envelope)
        .connect(gain)
        .connect(pan)
        .connect(listener === 0 ? this.local : this.remote);
      const s = {
        listener,
        point: { ...point },
        gain,
        pan,
        source,
        volume,
        until: now + duration,
      };
      this.active.push(s);
      this.spatial(s);
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        envelope.disconnect();
        gain.disconnect();
        pan.disconnect();
        this.active = this.active.filter((x) => x !== s);
      };
      source.start();
      source.stop(now + duration);
    }
  }
  get track() {
    return this.dest.stream.getAudioTracks()[0];
  }
  snapshot() {
    return {
      state: this.context.state,
      enabled: this.enabled,
      listeners: this.listeners.map((p) => ({
        position: { ...p.position },
        yaw: p.yaw,
      })),
      voices: this.active.length,
    };
  }
  dispose() {
    this.disposed = true;
    for (const s of this.active) {
      try {
        s.source.stop();
      } catch {}
    }
    this.active = [];
    this.dest.stream.getTracks().forEach((t) => t.stop());
    this.context.close().catch(() => {});
  }
}
