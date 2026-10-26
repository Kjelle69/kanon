import { CannonScene } from "./scene.js";
import { bindAction } from "./ui.js";
import { voice } from "./voice.js";
const $ = (id) => document.getElementById(id),
  H = $("hostCanvas"),
  P = $("previewCanvas"),
  V = $("remote");
const controlKeys = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);
let role = null,
  ready = false,
  game = null,
  stream = null,
  keys = {},
  ammo = "heavy",
  sender = () => {},
  state = null,
  seq = 0,
  lastRemoteSeq = -1,
  inputWindow = 0,
  inputCount = 0,
  lookX = 0,
  lookY = 0,
  lastSent = 0,
  joy = { x: 0, z: 0 };
const held = new Map();
const hurtTimers = [null, null];
const editing = (e) =>
  ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
  e.target.isContentEditable;
function ui() {
  $("viewport").hidden = !role;
  H.hidden = role !== "host";
  P.hidden = role !== "host";
  V.hidden = role !== "guest";
  $("previewPanel").hidden = role !== "host";
  $("screenTitle").textContent =
    role === "host"
      ? "Spelare 1 · förstaperson"
      : role === "guest"
        ? "Spelare 2 · kamera B"
        : "Skapa eller anslut till ett spel";
  const own = state?.players[role === "guest" ? 1 : 0],
    ended = state?.ended ?? false;
  for (const id of ["interactBtn", "lightBtn", "heavyBtn", "igniteBtn"])
    $(id).disabled = !role || ended;
  $("fireBtn").disabled = !role || !ready || ended || !own?.mounted;
  for (const id of ["stressBtn", "igniteBtn"]) $(id).hidden = role !== "host";
  $("playerState").textContent = !role
    ? "Ingen aktiv match"
    : ended
      ? "Matchen avslutad"
      : !ready
        ? "Väntar på motspelaren · förbered din position"
        : own?.mounted
          ? "Bemannar kanonen · E för att lämna"
          : "Till fots · E nära din kanon för att bemanna";
  $("heavyBtn").classList.toggle("accent", ammo === "heavy");
  $("lightBtn").classList.toggle("accent", ammo === "light");
  $("matchEnd").hidden = !ended;
  if (ended)
    $("winnerText").textContent =
      state.winner === null ? "Oavgjort" : `Spelare ${state.winner + 1} vann`;
  for (let i = 0; i < 2; i++) {
    const p = state?.players[i],
      hp = p?.hp ?? 100;
    $("hp" + i).value = hp;
    $("hpText" + i).textContent = `${Math.ceil(hp)} HP`;
    $("health" + i).classList.toggle("low", hp <= 30);
  }
}
function applyState(next) {
  if (
    !next ||
    !Array.isArray(next.players) ||
    next.players.length !== 2 ||
    !next.players.every(
      (p) => Number.isFinite(p.hp) && p.hp >= 0 && p.hp <= 100,
    )
  )
    return;
  for (let i = 0; i < 2; i++)
    if (state && next.players[i].hp < state.players[i].hp) {
      $("health" + i).classList.add("hurt");
      clearTimeout(hurtTimers[i]);
      hurtTimers[i] = setTimeout(
        () => $("health" + i).classList.remove("hurt"),
        350,
      );
    }
  const wasEnded = state?.ended;
  state = next;
  if (state.ended && !wasEnded) {
    release();
    document.exitPointerLock?.();
  }
  ui();
}
function unlockAudio() {
  game?.unlockAudio();
  for (const id of ["gameAudio", "voiceAudio"]) {
    const a = $(id);
    if (a.srcObject) a.play().catch(() => {});
  }
}
function fire() {
  if (!role || state?.ended) return;
  unlockAudio();
  if (role === "host") game?.fire(0);
  else sender({ type: "fire" });
}
function interact() {
  if (!role || state?.ended) return;
  unlockAudio();
  if (role === "host") {
    game?.interact(0);
    applyState(game.characters.snapshot());
  } else sender({ type: "interact" });
}
function setAmmo(a) {
  ammo = a;
  if (role === "host" && game) game.ammo[0] = a;
  else if (role === "guest") sender({ type: "ammo", ammo: a });
  ui();
}
function release() {
  held.clear();
  joy = { x: 0, z: 0 };
  lookX = lookY = 0;
  for (const k of Object.keys(keys)) if (!k.startsWith("g:")) delete keys[k];
  game?.motion(0, 0, 0);
  voice.talk(false);
  if (role === "guest") sendMotion(true);
  $("joystickKnob").style.transform = "translate(0px,0px)";
}
function axes() {
  return {
    x: Math.max(
      -1,
      Math.min(
        1,
        Number(!!(keys.d || keys.arrowright)) -
          Number(!!(keys.a || keys.arrowleft)) +
          joy.x,
      ),
    ),
    z: Math.max(
      -1,
      Math.min(
        1,
        Number(!!(keys.w || keys.arrowup)) -
          Number(!!(keys.s || keys.arrowdown)) +
          joy.z,
      ),
    ),
  };
}
function sendMotion(force = false) {
  if (!role || state?.ended) return;
  const now = performance.now(),
    move = axes();
  if (role === "host") {
    game?.motion(0, joy.x, joy.z);
    if (lookX || lookY) game?.look(0, lookX, lookY);
    lookX = lookY = 0;
    return;
  }
  if (!force && now - lastSent < 40) return;
  if (!force && !move.x && !move.z && !lookX && !lookY && now - lastSent < 250)
    return;
  sender({ type: "motion", seq: ++seq, x: move.x, z: move.z, lookX, lookY });
  lookX = lookY = 0;
  lastSent = now;
}
setInterval(() => sendMotion(), 40);
function look(dx, dy) {
  if (!role || state?.ended) return;
  const sensitivity = Number($("sensitivity").value);
  lookX = Math.max(-0.4, Math.min(0.4, lookX + dx * sensitivity));
  lookY = Math.max(-0.4, Math.min(0.4, lookY - dy * sensitivity));
}
function acceptInput(m) {
  if (role !== "host" || !game || !m || typeof m !== "object") return;
  const now = performance.now();
  if (now - inputWindow > 1000) {
    inputWindow = now;
    inputCount = 0;
  }
  if (++inputCount > 100) return;
  if (game.characters.damage.ended) return;
  if (m.type === "motion") {
    if (
      !Number.isSafeInteger(m.seq) ||
      m.seq <= lastRemoteSeq ||
      ![m.x, m.z, m.lookX, m.lookY].every(Number.isFinite) ||
      Math.abs(m.x) > 1 ||
      Math.abs(m.z) > 1 ||
      Math.abs(m.lookX) > 0.4 ||
      Math.abs(m.lookY) > 0.4
    )
      return;
    lastRemoteSeq = m.seq;
    game.motion(1, m.x, m.z);
    game.look(1, m.lookX, m.lookY);
    keys["g:d"] = m.x > 0;
    keys["g:a"] = m.x < 0;
    keys["g:w"] = m.z > 0;
    keys["g:s"] = m.z < 0;
  } else if (m.type === "fire") game.fire(1);
  else if (m.type === "interact") game.interact(1);
  else if (m.type === "ammo" && ["light", "heavy"].includes(m.ammo))
    game.ammo[1] = m.ammo;
}
function disconnect() {
  release();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  game?.dispose();
  game = null;
  voice.dispose();
  for (let i = 0; i < 2; i++) {
    clearTimeout(hurtTimers[i]);
    $("health" + i).classList.remove("hurt");
  }
  role = null;
  ready = false;
  state = null;
  keys = {};
  ammo = "heavy";
  seq = 0;
  lastRemoteSeq = -1;
  sender = () => {};
  inputCount = 0;
  lastSent = 0;
  document.exitPointerLock?.();
  $("gameAudio").srcObject = null;
  $("stats").textContent = "Ingen aktiv match.";
  $("fps").textContent = "– fps";
  ui();
}
window.KanonGame = {
  start({ role: nextRole, sendInput }) {
    disconnect();
    role = nextRole;
    sender = sendInput;
    ui();
    if (role === "host") {
      game = new CannonScene(H, P, () => keys);
      game.onState = (next) => {
        applyState(next);
        window.KanonLobby?.sendState(next);
      };
      applyState(game.characters.snapshot());
      H.focus();
    }
  },
  getGuestStream() {
    if (!game) throw Error("Hostens scen saknas");
    stream = P.captureStream(30);
    stream.addTrack(game.getGuestAudioTrack());
    return stream;
  },
  onInput: acceptInput,
  onState: applyState,
  onReady() {
    ready = true;
    ui();
    if (role === "host") {
      game.combatEnabled = true;
      applyState(game.characters.snapshot());
      window.KanonLobby?.sendState(game.characters.snapshot());
    } else {
      sender({ type: "ammo", ammo });
      sendMotion(true);
    }
  },
  onDisconnect: disconnect,
  snapshot() {
    return {
      role,
      hasSimulation: !!game,
      ...game?.snapshot(),
      state: state ? structuredClone(state) : null,
      keys: { ...keys },
      voice: voice.snapshot(),
      renderSize: [H.width, H.height, P.width, P.height],
      streamLive: stream?.getVideoTracks()[0]?.readyState === "live",
    };
  },
};
for (const [id, action] of [
  ["fireBtn", fire],
  ["interactBtn", interact],
  ["lightBtn", () => setAmmo("light")],
  ["heavyBtn", () => setAmmo("heavy")],
  ["stressBtn", () => game?.stress()],
  ["igniteBtn", () => game?.ignite()],
  ["newMatchBtn", () => window.KanonLobby.leaveMatch()],
  [
    "soundBtn",
    () => {
      unlockAudio();
      $("soundBtn").textContent = "Ljud aktiverat";
    },
  ],
  [
    "micBtn",
    () => {
      unlockAudio();
      voice.toggle();
    },
  ],
])
  bindAction($(id), action);
window.addEventListener(
  "keydown",
  (e) => {
    const key = e.key.toLowerCase();
    if (key === "escape") {
      document.exitPointerLock?.();
      release();
      return;
    }
    if (editing(e)) return;
    if (key === "v") {
      e.preventDefault();
      if (!e.repeat) voice.talk(true);
      return;
    }
    if (!role || state?.ended) return;
    unlockAudio();
    if (key === "e") {
      e.preventDefault();
      if (!e.repeat) interact();
      return;
    }
    if (key === " ") {
      e.preventDefault();
      if (!e.repeat) fire();
      return;
    }
    if (!controlKeys.has(key)) return;
    e.preventDefault();
    if (keys[key]) return;
    keys[key] = true;
    sendMotion(true);
  },
  { capture: true },
);
document.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (key === "v") {
    voice.talk(false);
    return;
  }
  if (controlKeys.has(key) && keys[key]) {
    keys[key] = false;
    sendMotion(true);
  }
});
window.addEventListener("blur", release);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) release();
});
document.addEventListener("focusin", (e) => {
  if (editing(e)) release();
});
function focusView(element) {
  element.focus();
  unlockAudio();
  if (element === V && V.paused) V.play().catch(() => {});
  if (state?.ended) return;
  if (matchMedia("(pointer:fine)").matches && element.requestPointerLock) {
    try {
      element.requestPointerLock()?.catch(() => {});
    } catch {}
  }
}
H.addEventListener("click", () => focusView(H));
V.addEventListener("click", () => focusView(V));
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === H || document.pointerLockElement === V)
    look(e.movementX, e.movementY);
});
document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement) release();
});
for (const button of document.querySelectorAll("[data-key]")) {
  const up = () => {
    const k = held.get(button);
    if (!k) return;
    held.delete(button);
    keys[k] = false;
    sendMotion(true);
  };
  button.addEventListener("pointerdown", (e) => {
    if (!role || state?.ended) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    held.set(button, button.dataset.key);
    keys[button.dataset.key] = true;
    sendMotion(true);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(name, up);
}
const stick = $("joystick"),
  knob = $("joystickKnob");
let stickPointer = null;
function moveStick(e) {
  const r = stick.getBoundingClientRect(),
    x = (e.clientX - r.left - r.width / 2) / (r.width / 2 - 10),
    z = -(e.clientY - r.top - r.height / 2) / (r.width / 2 - 10),
    n = Math.max(1, Math.hypot(x, z));
  joy = { x: x / n, z: z / n };
  knob.style.transform = `translate(${joy.x * ((r.width - knob.offsetWidth) / 2 - 4)}px,${-joy.z * ((r.height - knob.offsetHeight) / 2 - 4)}px)`;
  sendMotion();
}
stick.onpointerdown = (e) => {
  if (!role) return;
  e.preventDefault();
  unlockAudio();
  stickPointer = e.pointerId;
  stick.setPointerCapture(e.pointerId);
  moveStick(e);
};
stick.onpointermove = (e) => {
  if (e.pointerId === stickPointer) moveStick(e);
};
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  stick.addEventListener(name, () => {
    stickPointer = null;
    joy = { x: 0, z: 0 };
    knob.style.transform = "translate(0px,0px)";
    sendMotion(true);
  });
const pad = $("lookPad");
let lookPointer = null,
  previous = null;
pad.onpointerdown = (e) => {
  if (!role) return;
  e.preventDefault();
  lookPointer = e.pointerId;
  previous = { x: e.clientX, y: e.clientY };
  pad.setPointerCapture(e.pointerId);
};
pad.onpointermove = (e) => {
  if (e.pointerId !== lookPointer) return;
  look(e.clientX - previous.x, e.clientY - previous.y);
  previous = { x: e.clientX, y: e.clientY };
};
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  pad.addEventListener(name, () => {
    lookPointer = null;
    previous = null;
  });
const talk = $("talkBtn");
talk.onpointerdown = (e) => {
  e.preventDefault();
  talk.setPointerCapture(e.pointerId);
  voice.talk(true);
};
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  talk.addEventListener(name, () => voice.talk(false));
ui();

const mobileTalk = $("mobileTalkBtn");
mobileTalk.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  mobileTalk.setPointerCapture(e.pointerId);
  voice.talk(true);
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  mobileTalk.addEventListener(name, () => voice.talk(false));
