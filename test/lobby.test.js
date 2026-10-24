import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createLobby } from '../server.js';

async function setup(t, options = {}) {
  const lobby = createLobby(options);
  lobby.server.listen(0, '127.0.0.1'); await once(lobby.server, 'listening');
  const url = `http://127.0.0.1:${lobby.server.address().port}`;
  t.after(() => lobby.close());
  async function client(origin = 'http://localhost:8080') {
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin });
    const queue = [], waiters = [];
    ws.on('message', data => { const m = JSON.parse(data); if (waiters.length) waiters.shift()(m); else queue.push(m); });
    ws.next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Message timeout')), 2000);
      waiters.push(m => { clearTimeout(timer); resolve(m); });
    });
    ws.post = data => ws.send(JSON.stringify(data));
    await once(ws, 'open'); return ws;
  }
  return { ...lobby, url, client };
}
const ice = { candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0 };
test('health, static app, private files, origin validation', async t => {
  const { url, client } = await setup(t);
  assert.equal((await (await fetch(url + '/healthz')).json()).status, 'ok');
  assert.match(await (await fetch(url)).text(), /Skapa spel/);
  assert.equal((await fetch(url + '/server.js')).status, 404);
  await assert.rejects(client('https://evil.example'));
});
test('two isolated rooms, signaling roles, disconnect and rejoin protection', async t => {
  const { client, rooms } = await setup(t);
  const h = await client(), g = await client(), outsider = await client(), h2 = await client();
  h.post({ type: 'create' }); const { code } = await h.next(); assert.match(code, /^[1-9]\d{5}$/);
  h2.post({ type: 'create' }); const second = await h2.next(); assert.notEqual(second.code, code);
  outsider.post({ type: 'offer', sdp: 'v=0' }); assert.equal((await outsider.next()).error, 'not-paired');
  g.post({ type: 'join', code }); assert.equal((await g.next()).type, 'joined'); assert.equal((await h.next()).type, 'peer-ready');
  outsider.post({ type: 'join', code }); assert.equal((await outsider.next()).error, 'room-unavailable');
  g.post({ type: 'offer', sdp: 'v=0' }); assert.equal((await g.next()).error, 'invalid-state');
  h.post({ type: 'offer', sdp: 'v=0\r\n' }); assert.equal((await g.next()).type, 'offer');
  g.post({ type: 'answer', sdp: 'v=0\r\n' }); assert.equal((await h.next()).type, 'answer');
  g.post({ type: 'answer', sdp: 'v=0' }); assert.equal((await g.next()).error, 'invalid-state');
  h.post({ type: 'ice', candidate: ice, code: second.code }); assert.deepEqual((await g.next()).candidate, ice);
  h.post({ type: 'connected' }); g.post({ type: 'connected' });
  h.post({ type: 'physics', data: {} }); assert.equal((await h.next()).error, 'unsupported-message');
  assert.equal(rooms.size, 2);
  const closed = once(g, 'close'); g.close(); await closed;
  assert.equal((await h.next()).reason, 'peer-disconnected');
  outsider.post({ type: 'join', code }); assert.equal((await outsider.next()).error, 'room-unavailable');
  assert.equal(rooms.size, 1);
});
test('validation, malformed JSON, binary, payload size and attempts', async t => {
  const { client } = await setup(t); const ws = await client();
  ws.send('{'); assert.equal((await ws.next()).error, 'invalid-message');
  ws.send(Buffer.from('x')); assert.equal((await ws.next()).error, 'invalid-message');
  for (let i = 0; i < 10; i++) { ws.post({ type: 'join', code: '../x' }); assert.equal((await ws.next()).error, 'invalid-code'); }
  ws.post({ type: 'create' }); assert.equal((await ws.next()).error, 'rate-limit');
  const big = await client(); const closed = once(big, 'close'); big.send('x'.repeat(40000)); assert.equal((await closed)[0], 1009);
});
test('waiting and negotiation rooms expire; explicit leave cleans room', async t => {
  const { client, rooms } = await setup(t, { waitingMs: 100, negotiationMs: 100, tickMs: 10 });
  const h = await client(); h.post({ type: 'create' }); await h.next(); assert.equal((await h.next()).reason, 'timeout');
  h.post({ type: 'create' }); const { code } = await h.next(); const g = await client(); g.post({ type: 'join', code }); await g.next(); await h.next();
  assert.equal((await h.next()).reason, 'timeout'); await g.next(); assert.equal(rooms.size, 0);
  h.post({ type: 'create' }); await h.next(); h.post({ type: 'leave' }); assert.equal((await h.next()).reason, 'peer-left'); assert.equal(rooms.size, 0);
});
test('connection attempt limit per IP', async t => {
  const { client } = await setup(t);
  for (let i = 0; i < 30; i++) { const ws = await client(); ws.close(); }
  await assert.rejects(client());
});
