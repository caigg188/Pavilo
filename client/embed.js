(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloEmbed = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EMBED_SOURCE = 'pavilo-embed';
  const HOST_SOURCE = 'pavilo-host';
  const CHANNEL_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;

  function ancestorsFrom(scope) {
    const listed = scope?.__PAVILO_EMBED__?.ancestors;
    return Array.isArray(listed) ? listed.filter((origin) => typeof origin === 'string' && origin) : [];
  }

  function isEmbedDocument(pathname) {
    return pathname === '/embed' || pathname === '/embed/';
  }

  function isEmbedPlay(search) {
    return new URLSearchParams(search || '').get('embed') === '1';
  }

  function channelFromSearch(search) {
    const channelId = new URLSearchParams(search || '').get('channel') || '';
    return CHANNEL_ID_RE.test(channelId) ? channelId : '';
  }

  function playEmbedUrl(playId, channelId) {
    return `/plays/${encodeURIComponent(playId)}/?channel=${encodeURIComponent(channelId)}&embed=1`;
  }

  function embedReturnUrl(channelId) {
    return channelId ? `/embed?channel=${encodeURIComponent(channelId)}` : '/embed';
  }

  function makeInstanceId(random) {
    const value = `em_${Date.now().toString(36)}_${random().toString(36).slice(2)}`;
    return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  }

  function blankIdentity() {
    return { username: '', channelId: '', identityToken: '', resumeToken: '' };
  }

  function isJwt(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 8192) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
  }

  function credentialFromHash(hash) {
    const raw = String(hash || '');
    if (!raw.startsWith('#') || !raw.includes('pavilo=')) return '';
    let token = '';
    try { token = new URLSearchParams(raw.slice(1)).get('pavilo') || ''; }
    catch { return ''; }
    return isJwt(token) ? token : '';
  }

  function withCredential(url, token) {
    const clean = String(url || '').split('#')[0];
    if (!isJwt(token)) return clean;
    return `${clean}#pavilo=${encodeURIComponent(token)}`;
  }

  // Read a fragment credential and drop it from the address. Query strings are ignored.
  // The head script may already have stashed the value on __PAVILO_FRAGMENT_TOKEN__.
  function consumeFragmentToken(scope) {
    const location = scope?.location;
    let stashed = '';
    if (scope && typeof scope.__PAVILO_FRAGMENT_TOKEN__ === 'string') {
      stashed = scope.__PAVILO_FRAGMENT_TOKEN__;
      try { delete scope.__PAVILO_FRAGMENT_TOKEN__; }
      catch { scope.__PAVILO_FRAGMENT_TOKEN__ = ''; }
    }
    const fromHash = credentialFromHash(location?.hash || '');
    if (location && String(location.hash || '').includes('pavilo=')) {
      const next = `${location.pathname || ''}${location.search || ''}`;
      try { scope.history?.replaceState?.(null, '', next); } catch { /* address bar is best-effort */ }
    }
    return isJwt(stashed) ? stashed : fromHash;
  }

  function createEmbedBridge(options = {}) {
    const selfWindow = options.window || globalThis;
    const parent = options.parent === undefined ? selfWindow.parent : options.parent;
    const ancestors = new Set(options.ancestors || []);
    const random = options.random || Math.random;
    const listeners = new Set();
    let instance = options.instance || makeInstanceId(random);
    let parentOrigin = '';
    let identity = blankIdentity();

    function emit(event) {
      for (const listener of [...listeners]) listener(event);
      return event;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function post(type, fields = {}) {
      if (!parent || parent === selfWindow || typeof parent.postMessage !== 'function') return false;
      const target = type === 'hello' ? '*' : parentOrigin;
      if (!target) return false;
      const message = {
        v: 1,
        source: EMBED_SOURCE,
        type,
        instance,
        ...fields,
      };
      delete message.identityToken;
      delete message.resumeToken;
      try {
        parent.postMessage(message, target);
        return true;
      } catch {
        return false;
      }
    }

    function current() {
      return { ...identity };
    }

    function clear() {
      identity = blankIdentity();
    }

    function setResumeToken(token) {
      if (typeof token === 'string' && token) identity = { ...identity, resumeToken: token };
    }

    function acceptIdentity(data) {
      const username = typeof data.username === 'string' ? data.username.trim().slice(0, 80) : '';
      const channelId = typeof data.channelId === 'string' && CHANNEL_ID_RE.test(data.channelId) ? data.channelId : '';
      const identityToken = typeof data.identityToken === 'string' ? data.identityToken.slice(0, 8192) : '';
      const previous = identity;
      const tokenChanged = previous.identityToken !== identityToken;
      identity = {
        username,
        channelId,
        identityToken,
        resumeToken: tokenChanged ? '' : previous.resumeToken,
      };
      emit({ type: 'identity', identity: current() });
    }

    function handleMessage(event) {
      if (!event || event.source !== parent) return false;
      if (!ancestors.has(event.origin)) return false;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.v !== 1 || data.source !== HOST_SOURCE || data.type !== 'identity') return false;
      if (data.instance !== instance) return false;
      if (parentOrigin && event.origin !== parentOrigin) return false;
      parentOrigin = event.origin;
      acceptIdentity(data);
      return true;
    }

    function hello() {
      return post('hello');
    }

    function acceptFragment(token, channelId) {
      if (!isJwt(token)) return false;
      acceptIdentity({ username: '', channelId: channelId || '', identityToken: token });
      return true;
    }

    return {
      hello,
      post,
      handleMessage,
      acceptFragment,
      subscribe,
      current,
      clear,
      setResumeToken,
      get instance() { return instance; },
    };
  }

  return {
    EMBED_SOURCE,
    HOST_SOURCE,
    ancestorsFrom,
    isEmbedDocument,
    isEmbedPlay,
    channelFromSearch,
    playEmbedUrl,
    embedReturnUrl,
    credentialFromHash,
    withCredential,
    consumeFragmentToken,
    createEmbedBridge,
  };
});
