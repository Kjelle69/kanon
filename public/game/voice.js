// Optional voice, reserved on the existing game PeerConnection. No microphone
// permission is requested until the player explicitly enables the microphone.
export class VoiceChat {
  constructor() {
    this.epoch = 0;
    this.stream = null;
    this.sender = null;
    this.enabled = false;
    this.talking = false;
    this.busy = false;
    this.remote = document.querySelector("#voiceAudio");
  }
  attach(sender) {
    this.sender = sender;
    const epoch = this.epoch;
    if (this.stream)
      sender.replaceTrack(this.stream.getAudioTracks()[0]).catch(() => {
        if (epoch === this.epoch) this.status("Kunde inte ansluta mikrofonen");
      });
  }
  status(message) {
    document.querySelector("#voiceState").textContent = message;
  }
  async toggle() {
    if (this.busy) return;
    if (this.enabled) {
      this.stopMic();
      return;
    }
    const epoch = this.epoch;
    this.busy = true;
    this.status("Begär mikrofon…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (epoch !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.enabled = true;
      const track = stream.getAudioTracks()[0];
      track.enabled = false;
      if (this.sender) await this.sender.replaceTrack(track);
      if (epoch !== this.epoch) return;
      this.status("Mikrofon på · håll V eller Tala");
      document.querySelector("#micBtn").textContent = "Stäng mikrofon";
    } catch (e) {
      if (epoch === this.epoch) {
        this.stopMic();
        this.status("Mikrofon saknas eller nekades · spelet fortsätter");
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  talk(down) {
    this.talking = this.enabled && down;
    if (this.stream) this.stream.getAudioTracks()[0].enabled = this.talking;
    if (this.enabled)
      this.status(
        this.talking ? "Sänder röst" : "Mikrofon på · håll V eller Tala",
      );
  }
  receive(track) {
    const epoch = this.epoch,
      stream = new MediaStream([track]);
    this.remote.srcObject = stream;
    this.remote.play().catch(() => {
      if (epoch === this.epoch && this.remote.srcObject === stream)
        this.status("Tryck Aktivera ljud för att höra röst");
    });
  }

  stopMic() {
    this.enabled = false;
    this.talking = false;
    this.sender?.replaceTrack(null).catch(() => {});
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    document.querySelector("#micBtn").textContent = "Aktivera mikrofon";
    this.status("Mikrofon av");
  }
  dispose() {
    this.epoch++;
    this.busy = false;
    this.stopMic();
    this.sender = null;
    this.remote.srcObject = null;
  }
  snapshot() {
    return {
      enabled: this.enabled,
      talking: this.talking,
      track: this.stream?.getAudioTracks()[0]?.readyState ?? null,
      senderTrack: this.sender?.track?.id ?? null,
      receiving: !!this.remote.srcObject,
    };
  }
}
export const voice = new VoiceChat();
