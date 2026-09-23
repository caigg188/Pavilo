'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  try {
    return require(process.env.PAVILO_PLAYWRIGHT_PATH || 'playwright');
  } catch (cause) {
    throw new Error('Browser tests need Playwright and Google Chrome. Set PAVILO_PLAYWRIGHT_PATH to an installed playwright package.', { cause });
  }
}

const SERVER_BOOT = `
  const { loadConfig } = require(process.env.PAVILO_ROOT + '/config.js');
  const { createChatServer } = require(process.env.PAVILO_ROOT + '/server.js');
  const app = createChatServer(loadConfig({ env: { PAVILO_CONFIG: process.env.PAVILO_CONFIG } }).config);
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    try { await app.stop(); process.exit(0); }
    catch (error) { process.stderr.write(error.stack + '\\n'); process.exit(1); }
  }
  process.on('message', (message) => { if (message === 'stop') stop(); });
  process.on('disconnect', stop);
  app.listen(0, '127.0.0.1')
    .then((address) => process.send({ port: address.port }))
    .catch((error) => { console.error(error); process.exit(1); });
`;

function startPavilo(configPath) {
  const child = spawn(process.execPath, ['-e', SERVER_BOOT], {
    cwd: ROOT,
    env: { ...process.env, PAVILO_ROOT: ROOT, PAVILO_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`pavilo did not listen\n${output}`)), 15_000);
    child.once('message', (message) => {
      clearTimeout(timer);
      resolve({
        port: message.port,
        baseUrl: `http://127.0.0.1:${message.port}`,
        stop() {
          return new Promise((done) => {
            const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
            child.once('exit', () => { clearTimeout(killTimer); done(); });
            try { child.send('stop'); } catch { child.kill('SIGTERM'); }
          });
        },
      });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`pavilo exited ${code}\n${output}`));
    });
  });
}

function startStatic() {
  let html = '<!doctype html><title>empty</title>';
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        setHtml(next) { html = next; },
        close() { return new Promise((done) => server.close(() => done())); },
      });
    });
  });
}

function hostPage(paviloUrl, { answer = true } = {}) {
  return `<!doctype html><meta charset="utf-8"><title>host</title>
<iframe id="room" title="Pavilo" style="width:1200px;height:800px;border:0"></iframe>
<script>
  const pavilo = ${JSON.stringify(paviloUrl)};
  const origin = new URL(pavilo).origin;
  const iframe = document.getElementById('room');
  const answer = ${answer ? 'true' : 'false'};
  window.__events = [];
  let instance = '';
  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.v !== 1 || data.source !== 'pavilo-embed') return;
    window.__events.push(data);
    if (!answer || data.type !== 'hello') return;
    instance = data.instance;
    iframe.contentWindow.postMessage({
      v: 1, source: 'pavilo-host', type: 'identity', instance,
      channelId: 'general', username: 'Ada'
    }, origin);
    iframe.contentWindow.postMessage({
      v: 1, source: 'pavilo-host', type: 'identity', instance: 'stale',
      channelId: 'table', username: 'Eve', identityToken: 'super-secret-token'
    }, origin);
  });
  iframe.src = pavilo + '/embed';
</script>`;
}

test('a configured host can embed chat and return from a play without leaving the page', { timeout: 60_000 }, async (t) => {
  const { chromium } = loadPlaywright();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pavilo-embed-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = await startStatic();
  const stranger = await startStatic();
  t.after(() => host.close());
  t.after(() => stranger.close());
  const configPath = path.join(directory, 'pavilo.yaml');
  await writeFile(configPath, `version: 2
storage:
  driver: sqlite
  sqlite:
    path: ${JSON.stringify(path.join(directory, 'pavilo.db')).slice(1, -1)}
    engine: node
embed:
  ancestors:
    - ${host.origin}
room:
  title: Embed preview
  defaultChannel: general
  exposeLanUrls: false
channels:
  - id: general
    name: 闲聊
  - id: table
    name: 回声
    play: echo
plays:
  - echo
`);
  const pavilo = await startPavilo(configPath);
  t.after(() => pavilo.stop());
  host.setHtml(hostPage(pavilo.baseUrl));
  stranger.setHtml(hostPage(pavilo.baseUrl, { answer: false }));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  await page.goto(host.origin);
  const frame = page.frameLocator('#room');
  await frame.locator('#composerText').waitFor();
  const href = await frame.locator('body').evaluate(() => location.href);
  assert.equal(href.includes('super-secret-token'), false);
  assert.equal(href.includes('identityToken'), false);
  assert.equal(new URL(page.url()).origin, host.origin);

  await frame.locator('#composerText').fill('嵌进来了');
  await frame.locator('#composerText').press('Enter');
  await frame.locator('#messageList .message-body', { hasText: '嵌进来了' }).waitFor();

  await frame.locator('#channelList .channel').filter({ hasText: '· table' }).click();
  await frame.locator('#echoText').waitFor();
  assert.equal(new URL(page.url()).origin, host.origin);
  await frame.locator('#leave').click();
  await frame.locator('#composerText').waitFor();
  assert.equal(new URL(page.url()).pathname, '/');

  const during = await fetch(`${pavilo.baseUrl}/healthz`).then((response) => response.json());
  assert.equal(during.clients >= 1, true);
  await page.locator('#room').evaluate((node) => node.remove());
  let clients = during.clients;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    clients = (await fetch(`${pavilo.baseUrl}/healthz`).then((response) => response.json())).clients;
    if (clients === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(clients, 0);

  const blocked = await browser.newPage();
  blocked.setDefaultTimeout(15_000);
  await blocked.goto(stranger.origin);
  await blocked.waitForTimeout(800);
  const visible = await blocked.frameLocator('#room').locator('#composerText').count();
  assert.equal(visible, 0);
});

test('a top-level web container signs in from the fragment and keeps the credential out of the address bar', { timeout: 60_000 }, async (t) => {
  const { chromium } = loadPlaywright();
  const { signHs256 } = require(path.join(ROOT, 'src/identity'));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pavilo-embed-direct-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secret = '0123456789abcdef0123456789abcdef';
  const configPath = path.join(directory, 'pavilo.yaml');
  await writeFile(configPath, `version: 2
storage:
  driver: sqlite
  sqlite:
    path: ${JSON.stringify(path.join(directory, 'pavilo.db')).slice(1, -1)}
    engine: node
embed:
  direct: true
identity:
  guests: false
  audience: pavilo
  issuers:
    - id: app
      alg: HS256
      secret: ${secret}
room:
  title: Direct shell
  defaultChannel: staff
  exposeLanUrls: false
channels:
  - id: staff
    name: 内部
    access: authenticated
  - id: table
    name: 回声
    access: authenticated
    play: echo
plays:
  - echo
`);
  const pavilo = await startPavilo(configPath);
  t.after(() => pavilo.stop());
  const nowSec = Math.floor(Date.now() / 1000);
  const token = signHs256({
    iss: 'app',
    aud: 'pavilo',
    sub: 'ada',
    name: 'Ada',
    channels: ['staff', 'table'],
    iat: nowSec,
    exp: nowSec + 600,
  }, secret);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);

  await page.goto(`${pavilo.baseUrl}/embed?channel=staff&pavilo=${encodeURIComponent(token)}`);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#appShell').isHidden(), true);

  await page.goto(`${pavilo.baseUrl}/embed?channel=staff#pavilo=${encodeURIComponent(token)}`);
  await page.locator('#composerText').waitFor();
  const joined = new URL(page.url());
  assert.equal(joined.hash, '');
  assert.equal(joined.searchParams.get('pavilo'), null);
  assert.equal(page.url().includes(token), false);

  await page.locator('#composerText').fill('从壳里来');
  await page.locator('#composerText').press('Enter');
  await page.locator('#messageList .message-body', { hasText: '从壳里来' }).waitFor();

  await page.locator('#channelList .channel').filter({ hasText: '· table' }).click();
  await page.locator('#echoText').waitFor();
  const playing = new URL(page.url());
  assert.equal(playing.hash, '');
  assert.equal(playing.searchParams.get('embed'), '1');
  assert.equal(page.url().includes(token), false);
  await page.locator('#leave').click();
  await page.locator('#composerText').waitFor();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(page.url().includes(token), false);
});

test('an expired iframe credential is renewed by the next hello', { timeout: 60_000 }, async (t) => {
  const { chromium } = loadPlaywright();
  const { signHs256 } = require(path.join(ROOT, 'src/identity'));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pavilo-embed-renew-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = await startStatic();
  t.after(() => host.close());
  const secret = '0123456789abcdef0123456789abcdef';
  const configPath = path.join(directory, 'pavilo.yaml');
  await writeFile(configPath, `version: 2
storage:
  driver: sqlite
  sqlite:
    path: ${JSON.stringify(path.join(directory, 'pavilo.db')).slice(1, -1)}
    engine: node
embed:
  ancestors:
    - ${host.origin}
identity:
  guests: false
  audience: pavilo
  clockSkewSec: 0
  issuers:
    - id: app
      alg: HS256
      secret: ${secret}
room:
  title: Renew
  defaultChannel: general
  exposeLanUrls: false
channels:
  - id: general
    name: 闲聊
    access: authenticated
`);
  const pavilo = await startPavilo(configPath);
  t.after(() => pavilo.stop());
  const sign = (seconds) => {
    const nowSec = Math.floor(Date.now() / 1000);
    return signHs256({
      iss: 'app',
      aud: 'pavilo',
      sub: 'ada',
      name: 'Ada',
      channels: ['general'],
      iat: nowSec,
      exp: nowSec + seconds,
    }, secret);
  };
  const shortLived = sign(8);
  host.setHtml(`<!doctype html><meta charset="utf-8"><title>host</title>
<iframe id="room" title="Pavilo" style="width:1200px;height:800px;border:0"></iframe>
<script>
  const pavilo = ${JSON.stringify(pavilo.baseUrl)};
  const origin = new URL(pavilo).origin;
  const iframe = document.getElementById('room');
  const tokens = ${JSON.stringify([shortLived, sign(600)])};
  window.__hellos = 0;
  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.v !== 1 || data.source !== 'pavilo-embed' || data.type !== 'hello') return;
    const identityToken = tokens[Math.min(window.__hellos, tokens.length - 1)];
    window.__hellos += 1;
    iframe.contentWindow.postMessage({
      v: 1, source: 'pavilo-host', type: 'identity',
      instance: data.instance, channelId: 'general', username: 'Ada', identityToken,
    }, origin);
  });
  iframe.src = pavilo + '/embed';
</script>`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  await page.goto(host.origin);
  const frame = page.frameLocator('#room');
  await frame.locator('#composerText').waitFor();
  await page.waitForTimeout(9000);
  await frame.locator('#composerText').fill('过期前');
  await frame.locator('#composerText').press('Enter');
  await page.waitForFunction(() => window.__hellos >= 2);
  await frame.locator('#composerText').waitFor();
  await frame.locator('#composerText').fill('续上了');
  await frame.locator('#composerText').press('Enter');
  await frame.locator('#messageList .message-body', { hasText: '续上了' }).waitFor();
});
