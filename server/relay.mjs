#!/usr/bin/env node
/**
 * THE QUIET — a relay for shared runs, and a web server for the game.
 *
 *   npm run build && npm run server          # http://localhost:8787 (and your LAN address)
 *   PORT=9000 npm run server
 *
 * Friends on the same network open http://<your address>:8787/ and pick "Play with friends":
 * a page served from here uses this relay on its own. Over the internet the game connects
 * players peer-to-peer and does not need this at all; run it when a network blocks that,
 * or to keep everything on machines you control. It passes messages on and keeps nothing.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 8787);
const MAX_GUESTS = 8;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/relay.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ relay: '/relay' }));
    return;
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(existsSync(root) ? 'Not found.' : 'The game is not built yet: run `npm run build`, then start this again.');
  }
});

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** code → { host, guests: Map<id, ws>, next } */
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server, path: '/relay', maxPayload: 1 << 20 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  /** { kind: 'host', code } | { kind: 'guest', code, id } */
  let role = null;
  ws.on('message', (data) => {
    let m;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (!role) {
      if (m.t === 'host') {
        const code = newCode();
        rooms.set(code, { host: ws, guests: new Map(), next: 1 });
        role = { kind: 'host', code };
        send(ws, { t: 'hosted', code });
        log(`room ${code} opened`);
      } else if (m.t === 'join') {
        const code = String(m.code ?? '').toUpperCase();
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', reason: 'No game with that code.' });
        if (room.guests.size >= MAX_GUESTS) return send(ws, { t: 'error', reason: 'That room is full.' });
        const id = room.next++;
        room.guests.set(id, ws);
        role = { kind: 'guest', code, id };
        send(ws, { t: 'joined' });
        send(room.host, { t: 'peer', id });
        log(`room ${code}: guest ${id} joined`);
      }
      return;
    }
    const room = rooms.get(role.code);
    if (!room) return;
    if (role.kind === 'host') {
      const g = room.guests.get(Number(m.id));
      if (!g) return;
      if (m.t === 'to') send(g, { t: 'down', m: m.m });
      else if (m.t === 'kick') {
        room.guests.delete(Number(m.id));
        send(g, { t: 'closed', reason: 'The host closed the connection.' });
        g.close();
      }
    } else if (m.t === 'up') send(room.host, { t: 'from', id: role.id, m: m.m });
  });
  ws.on('close', () => {
    if (!role) return;
    const room = rooms.get(role.code);
    if (!room) return;
    if (role.kind === 'host') {
      for (const g of room.guests.values()) {
        send(g, { t: 'closed', reason: 'The host left.' });
        g.close();
      }
      rooms.delete(role.code);
      log(`room ${role.code} closed`);
    } else if (room.guests.get(role.id) === ws) {
      room.guests.delete(role.id);
      send(room.host, { t: 'left', id: role.id });
      log(`room ${role.code}: guest ${role.id} left`);
    }
  });
});

// drop connections that died without saying so
const beat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
wss.on('close', () => clearInterval(beat));

function log(s) {
  if (!process.env.QUIET_SILENT) console.log(`[relay] ${s}`);
}

server.listen(PORT, () => {
  const addrs = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${PORT}/`);
  console.log(`THE QUIET — game and relay on http://localhost:${PORT}/`);
  for (const a of addrs) console.log(`  friends on your network: ${a}`);
  if (!existsSync(root)) console.log('  (the game is not built yet: run `npm run build` — the relay works anyway)');
});
