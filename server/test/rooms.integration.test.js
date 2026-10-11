import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connectSocket } from 'socket.io-client';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function event(socket, name, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
    const onError = payload => { cleanup(); reject(new Error(payload?.message || 'Socket action failed')); };
    const onEvent = payload => { cleanup(); resolve(payload); };
    function cleanup() { clearTimeout(timer); socket.off(name, onEvent); socket.off('app:error', onError); }
    socket.once(name, onEvent);
    socket.once('app:error', onError);
  });
}
async function waitFor(predicate, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for room state');
}
test('room creation, QR, second-device join, server-authoritative start, reconnect, and kick', { timeout: 25000 }, async t => {
  const port = await freePort();
  const directory = await mkdtemp(path.join(tmpdir(), 'alsaha-test-'));
  const child = spawn(process.execPath, ['server/src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(directory, 'rooms.sqlite'), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); });
    await rm(directory, { recursive: true, force: true });
  });
  await waitFor(() => output.includes('server listening'), 10000);
  const url = `http://127.0.0.1:${port}`;
  const host = connectSocket(url, { transports: ['websocket'], reconnection: false });
  sockets.push(host);
  await event(host, 'connect');
  const createdPromise = event(host, 'room:created');
  host.emit('room:create', { gameId: 'trap', name: 'المضيف', settings: { rounds: 2 } });
  const created = await createdPromise;
  assert.match(created.room.code, /^[A-Z0-9]{5}$/);
  const qr = await fetch(`${url}/api/qr/${created.room.code}`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type') || '', /image\/png/);
  const guest = connectSocket(url, { transports: ['websocket'], reconnection: false });
  sockets.push(guest);
  await event(guest, 'connect');
  const joinedPromise = event(guest, 'room:joined');
  guest.emit('room:join', { code: created.room.code, name: 'لاعب ثاني' });
  const joined = await joinedPromise;
  assert.equal(joined.room.players.length, 2);
  assert.equal(joined.room.players.find(p => p.id === created.playerId).host, true);
  const updates = [];
  host.on('room:update', room => updates.push(room));
  const startedPromise = new Promise(resolve => { const handler = room => { if (room.status === 'playing') { host.off('room:update', handler); resolve(room); } }; host.on('room:update', handler); });
  host.emit('room:start');
  const started = await startedPromise;
  assert.equal(started.status, 'playing');
  assert.equal(Object.hasOwn(started.state, 'correct'), false, 'correct answer must not be sent to players');
  const session = created.session;
  const playerId = created.playerId;
  host.disconnect();
  await new Promise(resolve => setTimeout(resolve, 100));
  const returned = connectSocket(url, { transports: ['websocket'], reconnection: false });
  sockets.push(returned);
  await event(returned, 'connect');
  const reconnectPromise = event(returned, 'room:joined');
  returned.emit('room:join', { code: created.room.code, playerId, session, name: 'المضيف' });
  const reconnected = await reconnectPromise;
  assert.equal(reconnected.playerId, playerId);
  assert.equal(reconnected.room.status, 'playing');
  const kickedPromise = event(guest, 'room:kicked');
  returned.emit('room:kick', { targetId: joined.playerId });
  await kickedPromise;
  assert.equal(updates.some(room => room.code === created.room.code), true);
});
