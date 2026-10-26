import { CannonScene } from "./scene.js";
const $ = (id) => document.getElementById(id);
const held = new Map();
let role = null,
  game = null,
  stream = null,
  keys = {},
  ammo = "heavy",
  sendInput = () => {},
  inputWindow = 0,
  inputCount = 0;
const H = $("hostCanvas"),
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
function controls() {
  H.hidden = role !== "host";
  P.hidden = role !== "host";
  V.hidden = role !== "guest";
  $("screenTitle").textContent =
    role === "host"
      ? "Spelare 1 · kamera A"
      : role === "guest"
        ? "Spelare 2 · kamera B"
        : "Skapa eller anslut till ett spel";
  for (const id of ["fireBtn", "lightBtn", "heavyBtn", "igniteBtn"])
    $(id).disabled = !role;
  $("igniteBtn").hidden = role !== "host";
  $("stressBtn").hidden = role !== "host";
  $("previewPanel").hidden = role !== "host";
  $("heavyBtn").classList.toggle("accent", ammo === "heavy");
  $("lightBtn").classList.toggle("accent", ammo === "light");
}
function fire() {
  if (role === "host") game?.fire(0);
  else if (role === "guest") sendInput({ type: "fire" });
}
function setAmmo(value) {
  ammo = value;
  if (role === "host" && game) game.ammo[0] = ammo;
  else if (role === "guest") sendInput({ type: "ammo", ammo });
  controls();
}
function releaseKeys() {
  held.clear();
  for (const key of controlKeys)
    if (keys[key] && role === "guest")
      sendInput({ type: "key", key, down: false });
  for (const key of controlKeys) delete keys[key];
}
function acceptInput(m) {
  if (role !== "host" || !game || !m || typeof m !== "object") return;
  const now = performance.now();
  if (now - inputWindow > 1000) {
    inputWindow = now;
    inputCount = 0;
  }
  if (++inputCount > 120) return;
  if (m.type === "key" && controlKeys.has(m.key) && typeof m.down === "boolean")
    keys["g:" + m.key] = m.down;
  else if (m.type === "fire") game.fire(1);
  else if (m.type === "ammo" && ["light", "heavy"].includes(m.ammo))
    game.ammo[1] = m.ammo;
}
function disconnect() {
  releaseKeys();
  keys = {};
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  game?.dispose();
  game = null;
  role = null;
  ammo = "heavy";
  sendInput = () => {};
  inputCount = 0;
  inputWindow = 0;
  $("stats").textContent = "Ingen aktiv match.";
  $("fps").textContent = "– fps";
  controls();
}
window.KanonGame = {
  start({ role: nextRole, sendInput: sender }) {
    disconnect();
    role = nextRole;
    sendInput = sender;
    $("stats").textContent =
      role === "guest"
        ? "Kamera B från hosten · styrkommandon via DataChannel."
        : "Startar hostens simulering…";
    controls();
    if (role === "host") {
      game = new CannonScene(H, P, () => keys);
      H.focus();
    }
  },
  getGuestStream() {
    if (role !== "host" || !game) throw Error("Hostens scen saknas");
    stream = P.captureStream(30);
    return stream;
  },
  onInput: acceptInput,
  onReady() {
    if (role === "guest") sendInput({ type: "ammo", ammo });
  },
  onDisconnect: disconnect,
  // Read-only snapshots for diagnostics; simulation remains exclusively on the host.
  snapshot() {
    return {
      role,
      hasSimulation: !!game,
      ...game?.snapshot(),
      keys: { ...keys },
      renderSize: [H.width, H.height, P.width, P.height],
      streamLive: stream?.getVideoTracks()[0]?.readyState === "live",
    };
  },
};
$("fireBtn").onclick = fire;
$("lightBtn").onclick = () => setAmmo("light");
$("heavyBtn").onclick = () => setAmmo("heavy");
$("stressBtn").onclick = () => {
  if (role === "host") game?.stress();
};
window.addEventListener(
  "keydown",
  (e) => {
    if (
      !role ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
      e.target.isContentEditable
    )
      return;
    const key = e.key.toLowerCase();
    if (!controlKeys.has(key) && key !== " ") return;
    e.preventDefault();
    if (key === " ") {
      if (!e.repeat) fire();
      return;
    }
    if (keys[key]) return;
    keys[key] = true;
    if (role === "guest") sendInput({ type: "key", key, down: true });
  },
  { capture: true },
);
document.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (!controlKeys.has(key) || !keys[key]) return;
  keys[key] = false;
  if (role === "guest") sendInput({ type: "key", key, down: false });
});
window.addEventListener("blur", releaseKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseKeys();
});
controls();

$("igniteBtn").onclick = () => {
  if (role === "host") game?.ignite();
};
for (const button of document.querySelectorAll("[data-key]")) {
  const release = () => {
    const key = held.get(button);
    if (!key) return;
    held.delete(button);
    keys[key] = false;
    if (role === "guest") sendInput({ type: "key", key, down: false });
  };
  button.addEventListener("pointerdown", (e) => {
    if (!role) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    const key = button.dataset.key;
    held.set(button, key);
    keys[key] = true;
    if (role === "guest") sendInput({ type: "key", key, down: true });
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(event, release);
}

// The video is a game viewport, never a native media-control keyboard target.
V.addEventListener("click", () => {
  V.focus();
  if (V.paused) V.play().catch(() => {});
});
document.addEventListener("focusin", (e) => {
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
    e.target.isContentEditable
  )
    releaseKeys();
});
