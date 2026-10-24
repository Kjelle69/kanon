import express from 'express';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

export function createLobby(options = {}) {
  const app = express();
  const server = createServer(app);
  const rooms = new Map(), limits = new Map();
  const origins = new Set(options.origins ?? (process.env.ALLOWED_ORIGINS || 'https://kanon.mtecproductions.se,http://127.0.0.1:8080,http://localhost:8080').split(','));
  const waitingMs = options.waitingMs ?? 600000, negotiationMs = options.negotiationMs ?? 60000;
  const log = (event) => console.log(JSON.stringify({ time: new Date().toISOString(), event, rooms: rooms.size }));
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 262144) ws.terminate(); else ws.send(JSON.stringify(data)); } };
  function allow(ip, key, max) {
    if (!limits.has(ip)) { if (limits.size >= 10000) return false; limits.set(ip, { until: Date.now() + 60000 }); }
    const entry = limits.get(ip);
    if (Date.now() > entry.until) { entry.until = Date.now() + 60000; entry.connect = entry.join = entry.message = 0; }
    entry[key] = (entry[key] || 0) + 1;
    return entry[key] <= max;
  }
  function end(room, reason) {
    if (!room || !rooms.delete(room.code)) return;
    for (const ws of [room.host, room.guest]) if (ws) { ws.room = null; ws.opened = Date.now(); send(ws, { type: 'ended', reason }); }
    log(reason);
  }
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; media-src 'self' blob:; style-src 'self'; frame-ancestors 'self'", 'Cache-Control': 'no-store' }); next(); });
  app.get('/healthz', (req, res) => res.json({ status: 'ok', version: '0.2.0', rooms: rooms.size }));
  app.get('/config', (req, res) => res.json({ iceServers: JSON.parse(process.env.ICE_SERVERS || '[]') }));
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { dotfiles: 'deny' }));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    // Only trust Cloudflare identity for a loopback proxy connection.
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const ip = local && typeof req.headers['cf-connecting-ip'] === 'string' ? req.headers['cf-connecting-ip'] : req.socket.remoteAddress;
    if (req.url !== '/ws' || !origins.has(req.headers.origin) || !allow(ip, 'connect', 30) || wss.clients.size >= 500) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => { ws.ip = ip; wss.emit('connection', ws); });
  });
  wss.on('connection', ws => {
    ws.alive = true; ws.opened = Date.now();
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => log('socket-error'));
    ws.on('close', () => end(ws.room, 'peer-disconnected'));
    ws.on('message', (raw, binary) => {
      const fail = error => send(ws, { type: 'error', error });
      if (!allow(ws.ip, 'message', 600)) { ws.close(1008, 'rate-limit'); return; }
      let m;
      try { if (binary) throw Error(); m = JSON.parse(raw); if (!m || typeof m !== 'object' || Array.isArray(m)) throw Error(); } catch { return fail('invalid-message'); }
      if (m.type === 'leave') { end(ws.room, 'peer-left'); return; }
      if (m.type === 'create' || m.type === 'join') {
        if (ws.room) return fail('already-in-room');
        if (!allow(ws.ip, 'join', 10)) return fail('rate-limit');
        if (m.type === 'create') {
          if (rooms.size >= 200) return fail('capacity');
          let code; do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
          const room = { code, host: ws, guest: null, phase: 'waiting', deadline: Date.now() + waitingMs, connected: new Set() };
          rooms.set(code, room); ws.room = room; ws.role = 'host'; send(ws, { type: 'created', code }); log('room-created');
        } else {
          if (typeof m.code !== 'string' || !/^\d{6}$/.test(m.code)) return fail('invalid-code');
          const room = rooms.get(m.code);
          if (!room || room.guest || room.phase !== 'waiting') return fail('room-unavailable');
          room.guest = ws; ws.room = room; ws.role = 'guest'; room.phase = 'offer'; room.deadline = Date.now() + negotiationMs;
          send(ws, { type: 'joined', code: room.code }); send(room.host, { type: 'peer-ready' }); log('room-paired');
        }
        return;
      }
      const room = ws.room;
      if (!room?.guest) return fail('not-paired');
      const peer = ws === room.host ? room.guest : room.host;
      if (m.type === 'connected') {
        if (room.phase !== 'connecting' && room.phase !== 'active') return fail('invalid-state');
        room.connected.add(ws); if (room.connected.size === 2) { room.phase = 'active'; room.deadline = Date.now() + 14400000; log('room-connected'); } return;
      }
      if (m.type === 'offer' || m.type === 'answer') {
        if ((m.type === 'offer' && (ws.role !== 'host' || room.phase !== 'offer')) || (m.type === 'answer' && (ws.role !== 'guest' || room.phase !== 'answer'))) return fail('invalid-state');
        if (typeof m.sdp !== 'string' || m.sdp.length > 30000 || !m.sdp.startsWith('v=0')) return fail('invalid-sdp');
        room.phase = m.type === 'offer' ? 'answer' : 'connecting'; send(peer, { type: m.type, sdp: m.sdp }); return;
      }
      if (m.type === 'ice') {
        const c = m.candidate;
        if (!c || typeof c.candidate !== 'string' || c.candidate.length > 2048 || !(c.sdpMid === null || typeof c.sdpMid === 'string' && c.sdpMid.length < 100) || !(c.sdpMLineIndex === null || Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 100)) return fail('invalid-ice');
        send(peer, { type: 'ice', candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } }); return;
      }
      fail('unsupported-message');
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of limits) if (entry.until < now) limits.delete(ip);
    for (const room of rooms.values()) if (room.deadline < now) end(room, 'timeout');
    for (const ws of wss.clients) { if (!ws.alive || !ws.room && now - ws.opened > waitingMs) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, options.tickMs ?? 15000);
  timer.unref();
  async function close() { clearInterval(timer); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); }
  return { server, rooms, close };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lobby = createLobby();
  lobby.server.listen(Number(process.env.PORT || 8080), '127.0.0.1', () => console.log(JSON.stringify({ event: 'listening', address: '127.0.0.1:8080' })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await lobby.close(); process.exit(0); });
}
