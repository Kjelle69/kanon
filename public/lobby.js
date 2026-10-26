import "./game/streaminglab.js";
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
    clearInterval(s.statsTimer);
    s.channel?.close();
    s.pc?.close();
    s.stream?.getTracks().forEach((t) => t.stop());
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
    show(
      s.role === "host"
        ? "Spelet är igång. Du styr kanon A."
        : "Spelet är igång. Du styr kanon B.",
    );
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
      s.role !== "host" ||
      typeof event.data !== "string" ||
      event.data.length > 4096
    )
      return;
    try {
      window.KanonGame.onInput(JSON.parse(event.data));
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
  s.statsTimer = setInterval(async () => {
    if (!active(s) || s.readingStats) return;
    s.readingStats = true;
    try {
      const stats = await p.getStats();
      if (!active(s)) return;
      let bytes = 0,
        stamp = 0;
      for (const r of stats.values())
        if (
          r.kind === "video" &&
          r.type === (s.role === "host" ? "outbound-rtp" : "inbound-rtp")
        ) {
          bytes += r.bytesSent ?? r.bytesReceived ?? 0;
          stamp = Math.max(stamp, r.timestamp);
        }
      if (s.previousStats && stamp > s.previousStats.stamp)
        s.bitrate = Math.max(
          0,
          ((bytes - s.previousStats.bytes) * 8) /
            (stamp - s.previousStats.stamp),
        );
      s.previousStats = { bytes, stamp };
      state("bitrateState", s.bitrate.toFixed(0) + " kbit/s");
    } catch {
      /* Closing a connection may invalidate an outstanding stats read. */
    } finally {
      s.readingStats = false;
    }
  }, 1500);
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
    if (!active(s) || s.role !== "guest") return;
    video.srcObject = e.streams[0] || new MediaStream([e.track]);
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
    for (const track of s.stream.getTracks()) p.addTrack(track, s.stream);
    state("videoState", "Kamera B infångad · ansluter");
    await p.setLocalDescription(await p.createOffer());
    if (active(s)) send({ type: "offer", sdp: p.localDescription.sdp });
  } else if (m.type === "offer" || m.type === "answer") {
    const p = peer(s);
    await p.setRemoteDescription({ type: m.type, sdp: m.sdp });
    if (!active(s)) return;
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
    s.channel.bufferedAmount < 65536
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
create.onclick = () => {
  buttons(true);
  send({ type: "create" });
};
join.onsubmit = (e) => {
  e.preventDefault();
  const code = $("code").value.trim();
  if (/^\d{6}$/.test(code)) {
    buttons(true);
    send({ type: "join", code });
  }
};
leave.onclick = () => finish("Lämnar matchen…");
window.KanonLobby = {
  sendInput,
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
