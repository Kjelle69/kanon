import "./game/streaminglab.js";
import { RtcDiagnostics, renderDiagnostics } from "./game/rtc-diagnostics.js";
import { bindAction } from "./game/ui.js";
import { voice } from "./game/voice.js";
const $ = (id) => document.getElementById(id);
const create = $("create"),
  join = $("join"),
  leave = $("leave"),
  video = $("remote");
let ws,
  session = null,
  serial = Promise.resolve(),
  closing = false;
const config = await fetch("/config").then((r) => {
  if (!r.ok) throw Error("Konfiguration saknas");
  return r.json();
});
const show = (text) => {
  $("status").textContent = text;
};
const state = (id, text) => {
  $(id).textContent = text;
};
const send = (m) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
};
const active = (s) => session === s && !s.stopped;
function buttons(busy) {
  create.disabled = join.querySelector("button").disabled =
    busy || ws?.readyState !== WebSocket.OPEN;
}
function dispose() {
  const s = session;
  session = null;
  if (s) {
    s.stopped = true;
    clearTimeout(s.timer);
    clearTimeout(s.disconnectTimer);
    s.diagnostics?.dispose();
    s.channel?.close();
    s.pc?.close();
    s.stream?.getTracks().forEach((t) => t.stop());
    s.gameAudioStream = null;
  }
  window.KanonGame.onDisconnect();
  video.srcObject = null;
  state("bitrateState", "–");
  state("rtcState", "Ej startad");
  state("videoState", "Ej startad");
  state("channelState", "Stängd");
  leave.hidden = true;
}
function finish(reason) {
  if (closing || !session) return;
  closing = true;
  send({ type: "leave" });
  dispose();
  buttons(true);
  show(reason);
  // Wait for the server's ended acknowledgement before permitting another room.
}
function report(s) {
  if (!active(s)) return;
  if (
    !s.reported &&
    s.pc?.connectionState === "connected" &&
    s.channel?.readyState === "open"
  ) {
    s.reported = true;
    clearTimeout(s.timer);
    send({ type: "connected" });
    show("Spelet är igång. WASD för att gå, E vid din kanon.");
    if (s.role === "host") state("videoState", "Skickar kamera B · 640 × 480");
    window.KanonGame.onReady();
  }
}
function wireChannel(s, c) {
  if (!active(s)) {
    c.close();
    return;
  }
  if (s.channel) {
    c.close();
    return;
  }
  s.channel = c;
  c.onopen = () => {
    if (active(s)) {
      state("channelState", "Öppen");
      report(s);
    }
  };
  c.onmessage = (event) => {
    if (
      !active(s) ||
      typeof event.data !== "string" ||
      event.data.length > 4096
    )
      return;
    try {
      const message = JSON.parse(event.data);
      if (s.diagnostics?.message(message)) return;
      if (s.role === "host") window.KanonGame.onInput(message);
      else if (message.type === "state")
        window.KanonGame.onState(message.state);
    } catch {
      show("Ogiltigt styrkommando ignorerades.");
    }
  };
  c.onclose = () => {
    if (active(s))
      finish("Styrkanalen stängdes. Skapa eller anslut till en ny match.");
  };
  c.onerror = () => {
    if (active(s)) finish("Fel på styrkanalen. Försök med en ny match.");
  };
}
function peer(s) {
  if (s.pc) return s.pc;
  const p = (s.pc = new RTCPeerConnection(config));
  state("rtcState", "Ansluter");
  s.bitrate = 0;
  s.diagnostics = new RtcDiagnostics(
    p,
    video,
    s.role,
    () => s.channel,
    (row, history) => {
      if (!active(s)) return;
      s.bitrate = row.bitrateKbps ?? 0;
      state("bitrateState", s.bitrate.toFixed(0) + " kbit/s");
      renderDiagnostics(row, history);
    },
  );
  p.onicecandidate = (e) => {
    if (active(s) && e.candidate)
      send({ type: "ice", candidate: e.candidate.toJSON() });
  };
  p.onconnectionstatechange = () => {
    if (!active(s)) return;
    state("rtcState", p.connectionState);
    report(s);
    if (p.connectionState === "failed")
      finish(
        "WebRTC misslyckades. Kontrollera nätverk/STUN/TURN och försök igen.",
      );
    if (p.connectionState === "disconnected" && !s.disconnectTimer)
      s.disconnectTimer = setTimeout(() => {
        if (active(s)) finish("WebRTC-anslutningen bröts.");
      }, 8000);
    if (p.connectionState === "connected") {
      clearTimeout(s.disconnectTimer);
      s.disconnectTimer = null;
    }
  };
  p.ontrack = (e) => {
    if (!active(s)) return;
    if (e.track.kind === "audio") {
      const audio = p
        .getTransceivers()
        .filter((t) => t.receiver.track.kind === "audio");
      if (e.transceiver === audio.at(-1)) voice.receive(e.track);
      else if (s.role === "guest") {
        const output = document.querySelector("#gameAudio");
        output.srcObject = new MediaStream([e.track]);
        output.play().catch(() => {});
      }
      return;
    }
    if (s.role !== "guest") return;
    video.srcObject = new MediaStream([e.track]);
    state("videoState", "Mottar kamera B");
    e.track.onmute = () => {
      if (active(s)) state("videoState", "Väntar på videodata");
    };
    e.track.onunmute = () => {
      if (active(s)) state("videoState", "Mottar kamera B");
    };
    e.track.onended = () => {
      if (active(s)) state("videoState", "Avslutad");
    };
    video.play().catch(() => {
      if (active(s))
        state("videoState", "Tryck på videon för att starta uppspelningen");
    });
  };
  p.ondatachannel = (e) => {
    if (s.role === "guest" && e.channel.label === "controls")
      wireChannel(s, e.channel);
    else e.channel.close();
  };
  s.timer = setTimeout(() => {
    if (active(s))
      finish("WebRTC tog för lång tid. Kontrollera nätverk/STUN/TURN.");
  }, 55000);
  return p;
}
async function message(m) {
  if (m.type === "ended") {
    dispose();
    closing = false;
    buttons(false);
    state("lobbyState", "Ansluten");
    show(`Matchen avslutades: ${m.reason}. Du kan starta en ny match.`);
    return;
  }
  if (m.type === "error") {
    show(`Lobbyfel: ${m.error}`);
    if (session) finish(`Lobbyfel: ${m.error}. Matchen avslutas.`);
    else {
      closing = false;
      buttons(false);
    }
    return;
  }
  if (m.type === "created" || m.type === "joined") {
    if (session || closing) return;
    const role = m.type === "created" ? "host" : "guest";
    session = {
      role,
      pc: null,
      channel: null,
      pending: [],
      stopped: false,
      reported: false,
    };
    buttons(true);
    leave.hidden = false;
    state(
      "lobbyState",
      `Match ${m.code} · ${role === "host" ? "host" : "gäst"}`,
    );
    window.KanonGame.start({ role, sendInput });
    show(
      role === "host"
        ? `Matchkod: ${m.code}. Väntar på en spelare…`
        : "Ansluter till hosten…",
    );
    return;
  }
  const s = session;
  if (!s || !active(s)) return;
  if (m.type === "peer-ready" && s.role === "host") {
    const p = peer(s);
    wireChannel(s, p.createDataChannel("controls", { ordered: true }));
    s.stream = window.KanonGame.getGuestStream();
    for (const track of s.stream.getTracks()) {
      if (track.kind === "audio") {
        // Separate elements play game audio and video. A shared MSID also
        // couples their RTP playout clocks and can add avoidable video delay.
        s.gameAudioStream = new MediaStream([track]);
        p.addTransceiver(track, {
          direction: "sendonly",
          streams: [s.gameAudioStream],
        });
      } else p.addTrack(track, s.stream);
    }
    s.voiceTransceiver = p.addTransceiver("audio", { direction: "sendrecv" });
    voice.attach(s.voiceTransceiver.sender);
    state("videoState", "Kamera B infångad · ansluter");
    await p.setLocalDescription(await p.createOffer());
    if (active(s)) send({ type: "offer", sdp: p.localDescription.sdp });
  } else if (m.type === "offer" || m.type === "answer") {
    const p = peer(s);
    await p.setRemoteDescription({ type: m.type, sdp: m.sdp });
    if (!active(s)) return;
    if (m.type === "offer") {
      const audio = p
        .getTransceivers()
        .filter((t) => t.receiver.track.kind === "audio");
      const talk = audio.at(-1);
      if (talk) {
        talk.direction = "sendrecv";
        voice.attach(talk.sender);
      }
      if (audio.length > 1)
        document.querySelector("#gameAudio").srcObject = new MediaStream([
          audio[0].receiver.track,
        ]);
    }
    for (const candidate of s.pending) {
      await p.addIceCandidate(candidate);
      if (!active(s)) return;
    }
    s.pending = [];
    if (m.type === "offer") {
      await p.setLocalDescription(await p.createAnswer());
      if (active(s)) send({ type: "answer", sdp: p.localDescription.sdp });
    }
  } else if (m.type === "ice") {
    if (s.pc?.remoteDescription) await s.pc.addIceCandidate(m.candidate);
    else if (s.pending.length < 200) s.pending.push(m.candidate);
  }
}
function sendInput(input) {
  const s = session;
  if (
    s?.role === "guest" &&
    s.channel?.readyState === "open" &&
    s.channel.bufferedAmount < (input.type === "motion" ? 2048 : 8192)
  ) {
    const data = JSON.stringify(input);
    if (data.length <= 4096) s.channel.send(data);
  }
}
video.addEventListener("playing", () => {
  if (session?.role === "guest")
    state("videoState", "Spelar kamera B · 640 × 480");
});
function connect() {
  buttons(true);
  state("lobbyState", "Ansluter");
  const socket = (ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  ));
  socket.onopen = () => {
    if (ws !== socket) return;
    buttons(false);
    state("lobbyState", "Ansluten");
    show("Redo. Skapa ett spel eller ange en matchkod.");
  };
  socket.onmessage = (e) => {
    serial = serial
      .then(() => {
        if (ws === socket) return message(JSON.parse(e.data));
      })
      .catch((error) => {
        console.error("Lobby:", error);
        if (ws === socket) {
          if (session) finish("Spelet kunde inte startas. Försök igen.");
          else {
            buttons(false);
            show("Spelet kunde inte startas. Försök igen.");
          }
        }
      });
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    dispose();
    closing = false;
    buttons(true);
    state("lobbyState", "Frånkopplad");
    show("Lobbyanslutningen bröts. Återansluter…");
    setTimeout(connect, 3000);
  };
}
bindAction(create, () => {
  buttons(true);
  send({ type: "create" });
});
bindAction(join.querySelector("button"), (e) => {
  e.preventDefault();
  join.requestSubmit();
});
join.onsubmit = (e) => {
  e.preventDefault();
  const code = $("code").value.trim();
  if (/^\d{6}$/.test(code)) {
    buttons(true);
    send({ type: "join", code });
  }
};
bindAction(leave, () => finish("Lämnar matchen…"));
window.KanonLobby = {
  sendInput,
  get diagnostics() {
    return session?.diagnostics?.history ?? [];
  },
  sendState(state) {
    const s = session;
    if (
      s?.role === "host" &&
      s.channel?.readyState === "open" &&
      s.channel.bufferedAmount < 4096
    )
      s.channel.send(JSON.stringify({ type: "state", state }));
  },
  leaveMatch() {
    finish("Tillbaka till lobbyn…");
  },
  get bitrateKbps() {
    return session?.bitrate || 0;
  },
  get connectionState() {
    return session?.pc?.connectionState || "ej ansluten";
  },
  get snapshot() {
    return {
      role: session?.role,
      peerCount: session?.pc ? 1 : 0,
      channel: session?.channel?.readyState,
      streamLive: session?.stream?.getVideoTracks()[0]?.readyState === "live",
    };
  },
};
connect();

document.querySelector("#exportRtc").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(window.KanonLobby.diagnostics, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "kanon-rtc.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
