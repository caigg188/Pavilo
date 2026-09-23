'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createEmbedBridge, playEmbedUrl, embedReturnUrl, credentialFromHash, withCredential, consumeFragmentToken } = require('../client/embed');
const { loadConfig, parseConfig } = require('../config');
const { createChatServer } = require('../server');
const { defaultFeatures } = require('../src/core/capabilities');

async function listen(app) {
  const address = await app.listen(0, '127.0.0.1');
  return address.port;
}

test('embed bridge ignores a foreign origin, a stale instance, and keeps secrets out of replies', () => {
  const sent = [];
  const parent = {
    postMessage(data, origin) { sent.push({ data, origin }); },
  };
  const bridge = createEmbedBridge({
    window: {},
    parent,
    ancestors: ['http://127.0.0.1:4174'],
    instance: 'em_test',
    random: () => 0,
  });
  assert.equal(bridge.hello(), true);
  assert.equal(sent[0].origin, '*');
  assert.equal(sent[0].data.type, 'hello');
  assert.equal(sent[0].data.identityToken, undefined);

  const identity = {
    v: 1,
    source: 'pavilo-host',
    type: 'identity',
    instance: 'em_test',
    channelId: 'staff',
    username: 'Ada',
    identityToken: 'secret-token',
  };
  assert.equal(bridge.handleMessage({ source: parent, origin: 'http://evil.example', data: identity }), false);
  assert.equal(bridge.handleMessage({ source: {}, origin: 'http://127.0.0.1:4174', data: identity }), false);
  assert.equal(bridge.handleMessage({
    source: parent,
    origin: 'http://127.0.0.1:4174',
    data: { ...identity, instance: 'other' },
  }), false);
  assert.equal(bridge.current().identityToken, '');

  assert.equal(bridge.handleMessage({ source: parent, origin: 'http://127.0.0.1:4174', data: identity }), true);
  assert.equal(bridge.current().channelId, 'staff');
  bridge.setResumeToken('resume-1');
  assert.equal(bridge.handleMessage({
    source: parent,
    origin: 'http://127.0.0.1:4174',
    data: { ...identity, identityToken: 'next-token' },
  }), true);
  assert.equal(bridge.current().resumeToken, '');
  assert.equal(bridge.post('ready', { channelId: 'staff', identityToken: 'nope' }), true);
  assert.equal(sent.at(-1).origin, 'http://127.0.0.1:4174');
  assert.equal(sent.at(-1).data.identityToken, undefined);
  assert.equal(sent.at(-1).data.channelId, 'staff');
});

test('fragment credentials are accepted only from the hash and then removed', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.signature';
  assert.equal(credentialFromHash(`#pavilo=${token}`), token);
  assert.equal(credentialFromHash(`?pavilo=${token}`), '');
  assert.equal(credentialFromHash('#pavilo=not-a-jwt'), '');
  assert.equal(withCredential('/embed?channel=staff', token), `/embed?channel=staff#pavilo=${encodeURIComponent(token)}`);
  assert.equal(withCredential('/embed?channel=staff', 'not-a-jwt').includes('#'), false);

  const location = { pathname: '/embed', search: '?channel=staff', hash: `#pavilo=${token}` };
  const scope = {
    location,
    history: { replaceState(_state, _title, next) { scope.replaced = next; location.hash = ''; } },
    __PAVILO_FRAGMENT_TOKEN__: token,
  };
  const sent = [];
  const parent = { postMessage(data, origin) { sent.push({ data, origin }); } };
  const bridge = createEmbedBridge({
    window: {},
    parent,
    ancestors: ['http://127.0.0.1:4174'],
    instance: 'em_test',
  });
  assert.equal(consumeFragmentToken(scope), token);
  assert.equal(scope.replaced, '/embed?channel=staff');
  assert.equal(scope.__PAVILO_FRAGMENT_TOKEN__, undefined);
  assert.equal(bridge.acceptFragment(token, 'staff'), true);
  assert.equal(bridge.current().identityToken, token);
  assert.equal(bridge.hello(), true);
  assert.equal(sent.at(-1).data.identityToken, undefined);
  assert.equal(JSON.stringify(sent.at(-1).data).includes(token), false);
});

test('embed ancestors are an exact origin list on both config versions', () => {
  const memory = parseConfig('version: 1\nembed:\n  ancestors:\n    - http://127.0.0.1:4174\n');
  assert.deepEqual(memory.embedAncestors, ['http://127.0.0.1:4174']);
  assert.equal(memory.embedDirect, false);
  assert.equal(memory.storage.driver, 'memory');
  const direct = parseConfig('version: 1\nembed:\n  direct: true\n');
  assert.equal(direct.embedDirect, true);
  assert.deepEqual(direct.embedAncestors, []);
  assert.throws(() => parseConfig('version: 1\nembed:\n  direct: yes\n'), /embed\.direct/);
  assert.throws(() => parseConfig('version: 1\nembed:\n  ancestors:\n    - "*"\n'), /embed\.ancestors/);
  assert.throws(() => parseConfig('version: 1\nembed:\n  ancestors:\n    - http://127.0.0.1:4174/room\n'), /embed\.ancestors/);
  assert.throws(() => parseConfig(`version: 1\nembed:\n  ancestors:\n${Array.from({ length: 17 }, (_, index) => `    - http://127.0.0.1:${4174 + index}\n`).join('')}`), /最多 16/);
});

test('play return targets stay inside the embed frame', () => {
  assert.equal(playEmbedUrl('echo', 'table'), '/plays/echo/?channel=table&embed=1');
  assert.equal(embedReturnUrl('general'), '/embed?channel=general');
});

test('embed entry stays closed until ancestors are configured', async () => {
  const closed = createChatServer({ port: 0 });
  const closedPort = await listen(closed);
  const missing = await fetch(`http://127.0.0.1:${closedPort}/embed`);
  assert.equal(missing.status, 404);
  const home = await fetch(`http://127.0.0.1:${closedPort}/`);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('content-security-policy').includes('frame-ancestors'), false);
  await closed.stop();
});

test('direct embed serves the page without allowing any frame', async (t) => {
  const app = createChatServer({ port: 0, embedDirect: true });
  t.after(() => app.stop());
  const port = await listen(app);
  const base = `http://127.0.0.1:${port}`;
  const embed = await fetch(`${base}/embed`);
  assert.equal(embed.status, 200);
  assert.equal(embed.headers.get('x-frame-options'), 'DENY');
  assert.equal(embed.headers.get('content-security-policy').includes('frame-ancestors'), false);
  assert.match(await embed.text(), /__PAVILO_FRAGMENT_TOKEN__/);
  const info = await fetch(`${base}/room-info`);
  assert.deepEqual((await info.json()).embed, { enabled: true });
  const home = await fetch(`${base}/`);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
});

test('configured ancestors open only the embed document and play pages', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-embed-http-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = createChatServer({
    port: 0,
    embedAncestors: ['http://127.0.0.1:4174', 'http://localhost:4174'],
    storage: {
      driver: 'sqlite',
      sqlite: { path: path.join(directory, 'pavilo.db'), engine: 'node', retentionDays: 30 },
    },
    plays: ['echo'],
    operator: { token: '0123456789abcdef0123456789abcdef' },
    channels: [
      { id: 'general', name: '闲聊', enabled: true, readOnly: false, maxUsers: 8, welcome: '', access: 'open', features: defaultFeatures() },
      { id: 'table', name: '回声', enabled: true, readOnly: false, maxUsers: 8, welcome: '', access: 'open', features: defaultFeatures(), play: 'echo' },
    ],
  });
  const port = await listen(app);
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${port}`;

  const home = await fetch(`${base}/`);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal((await home.text()).includes('__PAVILO_EMBED__'), false);

  const embed = await fetch(`${base}/embed`);
  assert.equal(embed.status, 200);
  assert.equal(embed.headers.get('x-frame-options'), null);
  assert.match(embed.headers.get('content-security-policy'), /frame-ancestors http:\/\/127\.0\.0\.1:4174 http:\/\/localhost:4174;/);
  assert.equal(embed.headers.get('content-security-policy').includes('*'), false);
  const html = await embed.text();
  assert.match(html, /window\.__PAVILO_EMBED__=/);
  assert.doesNotMatch(html, /identityToken/);

  const style = await fetch(`${base}/chat.css`);
  assert.equal(style.headers.get('x-frame-options'), 'DENY');
  const client = await fetch(`${base}/client/app.js`);
  assert.equal(client.headers.get('x-frame-options'), 'DENY');
  const info = await fetch(`${base}/room-info`);
  assert.equal(info.headers.get('x-frame-options'), 'DENY');
  assert.deepEqual((await info.json()).embed, { enabled: true });

  const play = await fetch(`${base}/plays/echo/`);
  assert.equal(play.status, 200);
  assert.equal(play.headers.get('x-frame-options'), null);
  assert.match(play.headers.get('content-security-policy'), /frame-ancestors /);
  assert.match(await play.text(), /__PAVILO_EMBED__/);
  const asset = await fetch(`${base}/plays/echo/style.css`);
  assert.equal(asset.headers.get('x-frame-options'), null);
  const admin = await fetch(`${base}/admin`);
  assert.equal(admin.headers.get('x-frame-options'), 'DENY');
  const secret = await fetch(`${base}/plays/echo/host.js`);
  assert.equal(secret.status, 404);
});

test('the embed snippet in the integration note matches frame.js', () => {
  const snippet = fs.readFileSync(path.join(__dirname, '../examples/host-embed/frame.js'), 'utf8').trim();
  const note = fs.readFileSync(path.join(__dirname, '../docs/integrate.md'), 'utf8');
  assert.equal(note.includes(snippet), true);
});

test('alongside example opens /embed only for the website origins', async (t) => {
  const root = path.join(__dirname, '../examples/alongside');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /read_only:\s*false/);
  assert.match(compose, /\.\/data:\/app\/data/);
  assert.match(compose, /pavilo\.yaml:\/app\/pavilo\.yaml:ro/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-alongside-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'pavilo.db');
  const raw = fs.readFileSync(path.join(root, 'pavilo.yaml'), 'utf8');
  const configPath = path.join(directory, 'pavilo.yaml');
  fs.writeFileSync(configPath, raw.replace('path: /app/data/pavilo.db', `path: ${JSON.stringify(database)}`));
  const secret = '0123456789abcdef0123456789abcdef';
  const loaded = loadConfig({
    configPath,
    env: { ...process.env, PAVILO_IDENTITY_SECRET: secret },
  });
  assert.deepEqual(loaded.config.embedAncestors, ['http://127.0.0.1:4174', 'http://localhost:4174']);
  assert.equal(loaded.config.embedDirect, false);
  assert.equal(loaded.config.identity.issuers[0].secret, secret);
  const app = createChatServer(loaded.config);
  t.after(() => app.stop());
  const port = await listen(app);
  const embed = await fetch(`http://127.0.0.1:${port}/embed`);
  assert.equal(embed.status, 200);
  assert.equal(embed.headers.get('x-frame-options'), null);
  assert.match(embed.headers.get('content-security-policy'), /frame-ancestors http:\/\/127\.0\.0\.1:4174 http:\/\/localhost:4174;/);
  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
});
