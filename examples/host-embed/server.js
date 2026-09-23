'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { signHs256 } = require('../../src/identity');

const PORT = Number(process.env.HOST_PORT || 4174);
const PAVILO_URL = process.env.PAVILO_URL || 'http://127.0.0.1:4173';
const SECRET = process.env.PAVILO_IDENTITY_SECRET || '';
const USERS = {
  ada: { password: 'ada', sub: 'ada', name: 'Ada', channels: ['general', 'staff'] },
  guest: { password: 'guest', sub: 'guest', name: 'Guest', channels: ['general'] }
};

if (SECRET.length < 32) {
  process.stderr.write('Set PAVILO_IDENTITY_SECRET to the same 32+ character secret Pavilo uses.\n');
  process.exit(1);
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replaceAll('__PAVILO_URL__', PAVILO_URL);
const frameJs = fs.readFileSync(path.join(__dirname, 'frame.js'));

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/frame.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(frameJs);
    return;
  }
  if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  if (request.method === 'POST' && request.url === '/login') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
      const user = USERS[body.username];
      if (!user || user.password !== body.password) {
        json(response, 401, { ok: false, message: 'unknown user' });
        return;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const identityToken = signHs256({
        iss: 'app',
        aud: 'pavilo',
        sub: user.sub,
        name: user.name,
        channels: user.channels,
        iat: nowSec,
        exp: nowSec + 600
      }, SECRET);
      json(response, 200, {
        ok: true,
        identityToken,
        username: user.name,
        channels: user.channels,
        pavilo: PAVILO_URL,
      });
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`host-embed example on http://127.0.0.1:${PORT}\n`);
});
