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

  const drawCreatePromise = event(returned, 'room:created');
  returned.emit('room:create', { gameId: 'draw-it', name: 'المضيف' });
  const drawCreated = await drawCreatePromise;
  const drawGuests = [];
  for (const name of ['رسام ثاني', 'رسام ثالث']) {
    const socket = connectSocket(url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    drawGuests.push(socket);
    await event(socket, 'connect');
    const joinedDraw = event(socket, 'room:joined');
    socket.emit('room:join', { code: drawCreated.room.code, name });
    await joinedDraw;
  }
  const wordPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === drawCreated.room.code && room.state.wordChoices?.length === 3) {
        returned.off('room:private', handler);
        resolve(room);
      }
    };
    returned.on('room:private', handler);
  });
  const drawStartPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === drawCreated.room.code && room.status === 'playing') {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('room:start');
  await drawStartPromise;
  const privateDraw = await wordPromise;
  assert.equal(privateDraw.state.wordChoices.length, 3);
  const selectedWord = privateDraw.state.wordChoices[0];
  returned.emit('draw:choose-word', { word: selectedWord });
  const strokePromise = event(drawGuests[0], 'draw:stroke');
  returned.emit('draw:stroke', { stroke: { points: [{x:0.1,y:0.1},{x:0.3,y:0.3}], color: '#123456', size: 5, tool: 'pen' } });
  const deliveredStroke = await strokePromise;
  assert.equal(deliveredStroke.points.length, 2);
  const clearedPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === drawCreated.room.code && room.state.drawStrokes?.length === 0) {
        drawGuests[0].off('room:update', handler);
        resolve(room);
      }
    };
    drawGuests[0].on('room:update', handler);
  });
  returned.emit('draw:clear');
  await clearedPromise;

  const auctionCreatePromise = event(returned, 'room:created');
  returned.emit('room:create', { gameId: 'auction', name: 'المضيف', settings: { rounds: 3 } });
  const auctionCreated = await auctionCreatePromise;
  for (let i = 0; i < drawGuests.length; i++) {
    const joinedAuction = event(drawGuests[i], 'room:joined');
    drawGuests[i].emit('room:join', { code: auctionCreated.room.code, name: ['رسام ثاني', 'رسام ثالث'][i] });
    await joinedAuction;
  }
  const auctionStartPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === auctionCreated.room.code && room.status === 'playing') {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('room:start');
  await auctionStartPromise;
  for (const [socket, amount] of [[returned, 2], [drawGuests[0], 3], [returned, 4]]) {
    const expectedLength = amount === 2 ? 1 : amount === 3 ? 2 : 3;
    const bidUpdate = new Promise(resolve => {
      const handler = room => {
        if (room.code === auctionCreated.room.code && room.state.bids?.length === expectedLength) {
          socket.off('room:update', handler);
          resolve(room);
        }
      };
      socket.on('room:update', handler);
    });
    socket.emit('auction:bid', { amount });
    await bidUpdate;
  }
  const proofPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === auctionCreated.room.code && room.state.phase === 'prove') {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('auction:prove');
  await proofPromise;
  const submittedPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === auctionCreated.room.code && room.state.submittedAnswers?.[auctionCreated.playerId]?.length === 1) {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('game:answer', { answer: 'تفاح' });
  await submittedPromise;
  const scoredPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === auctionCreated.room.code && room.players.find(p => p.id === auctionCreated.playerId)?.score > 0) {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('auction:judge', { answerIndex: 0, correct: true });
  await scoredPromise;
  const secretRoundPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === auctionCreated.room.code && room.state.round === 2 && room.state.auctionType === 'secret') {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('game:next');
  const secretRound = await secretRoundPromise;
  assert.equal(Object.hasOwn(secretRound.state, 'bids'), false, 'secret bids must be hidden from public state');
  const doubleRoundPromise = new Promise(resolve => {
    const handler = room => {
      if (room.code === auctionCreated.room.code && room.state.round === 3 && room.state.phase === 'double') {
        returned.off('room:update', handler);
        resolve(room);
      }
    };
    returned.on('room:update', handler);
  });
  returned.emit('game:next');
  await doubleRoundPromise;
});
