'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2'
};
// The interface, the icon set and the emoji data are large text assets that are
// fetched on every reload, and Pavilo is usually reached over Wi-Fi — where the
// wire is the slow part, not the CPU that compresses it. Bodies are small enough
// to compress whole and hold in memory, so there is no streaming path here.
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript))/;
const COMPRESSION_MIN_BYTES = 1024;
const gzipAsync = promisify(zlib.gzip);
const vendorEtagCache = new Map();
// Content with a stable request-independent body: index.html plus everything
// under vendor/. Keyed by entity tag; see encodedBodyFor.
const compressedBodyCache = new Map();

function acceptsGzip(request) {
  const header = request.headers['accept-encoding'];
  if (typeof header !== 'string') return false;
  // The token boundaries keep `x-gzip` from matching a bare `gzip`.
  return /(^|[\s,])gzip(?:[\s;,]|$)/.test(header.toLowerCase());
}

// Only used for bodies that never vary by request (index.html and vendor files).
// The compressed copy is keyed by the entity tag, so an edited file changes its
// tag and can never be served from a stale entry; in practice the set of keys is
// bounded by the files on disk because a redeploy restarts the process.
async function encodedBodyFor(request, etag, type, data) {
  const identity = { body: data, contentLength: data.length, encoding: null };
  if (!acceptsGzip(request) || data.length < COMPRESSION_MIN_BYTES || !COMPRESSIBLE_TYPE.test(String(type || ''))) return identity;
  const cached = compressedBodyCache.get(etag);
  if (cached) return cached;
  try {
    const compressed = await gzipAsync(data);
    const entry = { body: compressed, contentLength: compressed.length, encoding: 'gzip' };
    compressedBodyCache.set(etag, entry);
    return entry;
  } catch {
    return identity;
  }
}


const CHAT_CLIENT_FILES = new Set(['protocol', 'state', 'performance', 'connection', 'pending', 'images', 'messages', 'overlays', 'mentions', 'composer', 'notifications', 'error-states', 'i18n', 'embed', 'app'].map((name) => `/client/${name}.js`));
const PLAY_CLIENT_FILES = new Set(['/client/play.js', '/client/embed.js']);
const CLIENT_FILES = new Set([...CHAT_CLIENT_FILES, ...PLAY_CLIENT_FILES]);
const APP_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;";

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
  return [...new Set(addresses)];
}
function createHttpHandler(config, core, address, ROOT, extras = {}) {
  function embedAncestorList() {
    return Array.isArray(config.embedAncestors) ? config.embedAncestors : [];
  }

  function frameHeaders(embeddable) {
    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (!embeddable) headers['X-Frame-Options'] = 'DENY';
    return headers;
  }

  function contentSecurityPolicy(embeddable) {
    const ancestors = embedAncestorList();
    if (!embeddable || !ancestors.length) return APP_CSP;
    return `${APP_CSP} frame-ancestors ${ancestors.join(' ')};`;
  }

  function embedOpen() {
    return embedAncestorList().length > 0 || config.embedDirect === true;
  }

  function embedBoot(html) {
    if (!embedOpen() || !html.includes('</head>')) return html;
    const ancestors = embedAncestorList();
    const script = `<script>(function(){try{var path=location.pathname||"";var search=location.search||"";var embedDoc=path==="/embed"||path==="/embed/"||new URLSearchParams(search).get("embed")==="1";var hash=location.hash||"";if(hash.indexOf("pavilo=")!==-1){if(embedDoc){var token=new URLSearchParams(hash.slice(1)).get("pavilo")||"";if(token)window.__PAVILO_FRAGMENT_TOKEN__=token;}history.replaceState(null,"",path+search);}}catch(e){}})();window.__PAVILO_EMBED__=${JSON.stringify({ ancestors })};</script>`;
    return html.replace('</head>', `${script}</head>`);
  }

  async function serveVendorFile(request, response, pathname, headOnly = false) {
    const relative = pathname.slice('/vendor/'.length);
    if (relative.startsWith('/') || relative.includes('..') || relative.includes('\0')) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Forbidden');
      return;
    }
    const extension = path.extname(relative).toLowerCase();
    let filename;
    try {
      const publicRoot = await fs.promises.realpath(ROOT);
      const vendorRoot = path.join(publicRoot, 'vendor');
      if (await fs.promises.realpath(vendorRoot) !== vendorRoot) throw new Error('Not public');
      filename = await fs.promises.realpath(path.join(vendorRoot, relative));
      if (!filename.startsWith(`${vendorRoot}${path.sep}`) || (!MIME_TYPES[extension] && path.basename(relative) !== 'LICENSE')) throw new Error('Not public');
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    fs.readFile(filename, async (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(headOnly ? undefined : 'Not found');
        return;
      }
      // ETag lets the emoji picker validate its cache with a cheap HEAD request,
      // avoiding its fallback checksum path which needs crypto.subtle (missing on
      // plain-HTTP LAN origins where Pavilo is typically accessed).
      let etag = vendorEtagCache.get(relative);
      if (!etag) {
        etag = `"sha1-${crypto.createHash('sha1').update(data).digest('hex')}"`;
        vendorEtagCache.set(relative, etag);
      }
      const type = MIME_TYPES[extension] || 'application/octet-stream';
      const encoded = await encodedBodyFor(request, etag, type, data);
      const headers = {
        'Content-Type': type,
        'Content-Length': encoded.contentLength,
        ETag: etag,
        // The same ETag is served for both encodings, so a shared cache must key
        // on Accept-Encoding or it can hand a gzipped body to a client that never
        // asked for one.
        Vary: 'Accept-Encoding',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      };
      if (encoded.encoding) headers['Content-Encoding'] = encoded.encoding;
      response.writeHead(200, headers);
      response.end(headOnly ? undefined : encoded.body);
    });
  }

  // App resources are explicit routes, never a directory mount. Reject symlinks
  // even when they resolve inside the project: a public name must not alias a
  // config file or another private source file.
  async function serveAppFile(request, response, filename, headOnly = false) {
    const extension = path.extname(filename).toLowerCase();
    const type = MIME_TYPES[extension] || 'application/octet-stream';
    let target;
    try {
      const publicRoot = await fs.promises.realpath(ROOT);
      target = await fs.promises.realpath(path.join(ROOT, filename));
      const expected = path.join(publicRoot, filename);
      if (target !== expected) throw new Error('Not public');
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    fs.readFile(target, async (error, data) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(headOnly ? undefined : `${filename} is missing`);
        return;
      }
      const etag = `"app-${data.length.toString(16)}-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
      const encoded = await encodedBodyFor(request, etag, type, data);
      const headers = {
        'Content-Type': type,
        'Content-Length': encoded.contentLength,
        // Revalidate on every load so redeployments are picked up, while still
        // allowing a 304 — reloads keep the page they are already showing.
        'Cache-Control': 'no-cache',
        ETag: etag,
        Vary: 'Accept-Encoding',
        ...frameHeaders(false),
        'Content-Security-Policy': contentSecurityPolicy(false),
      };
      if (encoded.encoding) headers['Content-Encoding'] = encoded.encoding;
      response.writeHead(200, headers);
      response.end(headOnly ? undefined : encoded.body);
    });
  }

  async function serveEmbedDocument(request, response, headOnly = false) {
    if (!embedOpen()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    let raw;
    try {
      raw = await fs.promises.readFile(path.join(ROOT, 'index.html'));
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'index.html is missing');
      return;
    }
    const data = Buffer.from(embedBoot(raw.toString('utf8')));
    const type = 'text/html; charset=utf-8';
    const etag = `"embed-${data.length.toString(16)}-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
    const encoded = await encodedBodyFor(request, etag, type, data);
    const frameable = embedAncestorList().length > 0;
    const headers = {
      'Content-Type': type,
      'Content-Length': encoded.contentLength,
      'Cache-Control': 'no-cache',
      ETag: etag,
      Vary: 'Accept-Encoding',
      ...frameHeaders(frameable),
      'Content-Security-Policy': contentSecurityPolicy(frameable),
    };
    if (encoded.encoding) headers['Content-Encoding'] = encoded.encoding;
    response.writeHead(200, headers);
    response.end(headOnly ? undefined : encoded.body);
  }

  function jsonResponse(response, status, payload, headOnly = false) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(headOnly ? undefined : body);
  }

  return (request, response) => {
    let requestUrl;
    try { requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`); }
    catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }
    const isHead = request.method === 'HEAD';
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/healthz') {
      const payload = core.health();
      if (typeof extras.healthPatch === 'function') Object.assign(payload, extras.healthPatch());
      jsonResponse(response, 200, payload, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/room-info') {
      const activePort = address()?.port || config.port;
      jsonResponse(response, 200, {
        ...core.roomInfo(),
        localUrl: `http://localhost:${activePort}`,
        lanUrls: config.exposeLanUrls ? localAddresses().map((address) => `http://${address}:${activePort}`) : []
      }, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html' || requestUrl.pathname === '/chat')) {
      serveAppFile(request, response, 'index.html', isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && (requestUrl.pathname === '/embed' || requestUrl.pathname === '/embed/')) {
      serveEmbedDocument(request, response, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/chat.css') {
      serveAppFile(request, response, 'chat.css', isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && CLIENT_FILES.has(requestUrl.pathname)) {
      serveAppFile(request, response, requestUrl.pathname.slice(1), isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname.startsWith('/vendor/')) {
      serveVendorFile(request, response, requestUrl.pathname, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname.startsWith('/plays/')) {
      servePlayFile(request, response, requestUrl.pathname, isHead);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(isHead ? undefined : 'Not found');
  };

  async function servePlayFile(request, response, pathname, headOnly = false) {
    const enabled = new Set(config.plays || extras.plays || []);
    const parts = pathname.slice('/plays/'.length).split('/').filter(Boolean);
    const playId = parts[0];
    if (!playId || parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    if (!enabled.has(playId)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    if (parts.length === 1 && !pathname.endsWith('/')) {
      response.writeHead(302, { Location: `/plays/${playId}/`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    const rest = parts.slice(1);
    const underAssets = rest[0] === 'assets';
    const relative = underAssets ? rest.slice(1).join('/') : rest.join('/');
    const filename = relative || 'index.html';
    const extension = path.extname(filename).toLowerCase();
    if ((underAssets && !relative) || (!MIME_TYPES[extension] && path.basename(filename) !== 'LICENSE')) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    try {
      const publicRoot = await fs.promises.realpath(ROOT);
      const playRoot = await fs.promises.realpath(path.join(publicRoot, 'plays', playId));
      if (!playRoot.startsWith(`${publicRoot}${path.sep}plays${path.sep}`)) throw new Error('Not public');
      const areaRoot = path.join(playRoot, underAssets ? 'assets' : 'page');
      const areaReal = await fs.promises.realpath(areaRoot);
      if (!areaReal.startsWith(`${playRoot}${path.sep}`) && areaReal !== playRoot) throw new Error('Not public');
      const target = await fs.promises.realpath(path.join(areaRoot, filename));
      if (!target.startsWith(`${areaReal}${path.sep}`) && target !== areaReal) throw new Error('Not public');
      const embedFrameable = embedAncestorList().length > 0;
      let bytes = await fs.promises.readFile(target);
      if (embedOpen() && extension === '.html') bytes = Buffer.from(embedBoot(bytes.toString('utf8')));
      const data = bytes;
      const type = MIME_TYPES[extension] || 'application/octet-stream';
      const etag = `"play-${data.length.toString(16)}-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
      const encoded = await encodedBodyFor(request, etag, type, data);
      const headers = {
        'Content-Type': type,
        'Content-Length': encoded.contentLength,
        'Cache-Control': 'no-cache',
        ETag: etag,
        Vary: 'Accept-Encoding',
        ...frameHeaders(embedFrameable),
        'Content-Security-Policy': contentSecurityPolicy(embedFrameable),
      };
      if (encoded.encoding) headers['Content-Encoding'] = encoded.encoding;
      response.writeHead(200, headers);
      response.end(headOnly ? undefined : encoded.body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
    }
  }

}
module.exports = { createHttpHandler, localAddresses, CLIENT_FILES, CHAT_CLIENT_FILES, PLAY_CLIENT_FILES };
