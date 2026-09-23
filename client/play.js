(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloPlay = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NEXT_KEY = 'pavilo.next';

  function makeClientActionId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    const value = uuid || `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
  }

  function playPageUrl(playId, channelId) {
    return `/plays/${playId}/?channel=${encodeURIComponent(channelId)}`;
  }

  function createPlayClient(options = {}) {
    const protocol = options.protocol || (typeof PaviloProtocol !== 'undefined' ? PaviloProtocol : null);
    const Connection = options.Connection || (typeof PaviloConnection !== 'undefined' ? PaviloConnection : null);
    const location = options.location || globalThis.location;
    const storage = options.storage === undefined ? globalThis.sessionStorage : options.storage;
    const fetchImpl = options.fetch || globalThis.fetch;
    const EmbedApi = globalThis.PaviloEmbed;
    const embedded = EmbedApi?.isEmbedPlay?.(location?.search || '') || false;
    const memory = new Map();
    const embedStorage = {
      getItem(key) { return memory.has(key) ? memory.get(key) : null; },
      setItem(key, value) { memory.set(key, String(value)); },
      removeItem(key) { memory.delete(key); },
    };
    const connection = Connection.createConnection({
      WebSocket: options.WebSocket,
      location,
      storage: embedded ? embedStorage : storage,
      timers: options.timers,
      getIdentity: () => identity || {},
    });
    const listeners = new Set();
    let channels = [];
    let roomInfo = null;
    let identity = null;
    let desiredChannelId = null;
    let started = false;

    function emit(event) {
      for (const listener of [...listeners]) listener(event);
      return event;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function currentChannel() {
      return channels.find((channel) => channel.id === desiredChannelId) || null;
    }

    function playAction(name, payload) {
      const clientActionId = makeClientActionId();
      const sent = connection.send({
        type: 'playAction',
        clientActionId,
        name,
        payload: payload && typeof payload === 'object' ? payload : {}
      });
      return sent ? clientActionId : null;
    }

    function sendMessage(text) {
      const clientMessageId = makeClientActionId();
      return connection.send({
        type: 'message',
        clientMessageId,
        kind: 'text',
        text
      }) ? clientMessageId : null;
    }

    function leave() {
      if (connection.getSocket()?.readyState === (options.WebSocket || globalThis.WebSocket)?.OPEN) {
        connection.sendRaw({ type: 'leave' });
      }
      connection.close({ intentional: true });
      connection.clearSession();
      connection.clearChannelId();
      try { storage?.removeItem(NEXT_KEY); } catch { /* ignore */ }
    }

    function switchToChannel(channel) {
      if (!channel || !channel.enabled) return false;
      if (channel.play) {
        if (embedded) connection.close({ intentional: true });
        const nextPlay = embedded ? EmbedApi.playEmbedUrl(channel.play, channel.id) : playPageUrl(channel.play, channel.id);
        location.assign(embedded ? EmbedApi.withCredential(nextPlay, identity?.identityToken) : nextPlay);
        return true;
      }
      if (embedded) {
        if (connection.getSocket()?.readyState === (options.WebSocket || globalThis.WebSocket)?.OPEN) {
          connection.sendRaw({ type: 'leave' });
        }
        connection.close({ intentional: true });
        location.assign(EmbedApi.withCredential(EmbedApi.embedReturnUrl(channel.id), identity?.identityToken));
        return true;
      }
      connection.writeChannelId(channel.id);
      const sent = connection.sendRaw({ type: 'switchChannel', channelId: channel.id });
      if (!sent) return false;
      const unsub = connection.subscribe((event) => {
        if (event.type !== 'payload') return;
        const parsed = protocol.parseServerEvent(event.payload);
        if (parsed?.type === 'stateStart' && parsed.channelId === channel.id) {
          unsub();
          location.assign('/');
        }
      });
      return true;
    }

    function handlePayload(payload) {
      const event = protocol.parseServerEvent(payload);
      if (!event) return;
      if (event.type === 'stateStart') {
        if (event.resumeToken && event.self?.username) {
          connection.setSession({ token: event.resumeToken, username: event.self.username });
          identity = { ...(identity || {}), resumeToken: event.resumeToken, username: event.self.username, channelId: event.channelId };
        }
        if (event.channelId) connection.writeChannelId(event.channelId);
        connection.markJoined(true);
        if (desiredChannelId && event.channelId !== desiredChannelId) {
          connection.sendRaw({ type: 'switchChannel', channelId: desiredChannelId });
        }
      }
      emit(event);
    }

    async function loadRoomInfo() {
      const response = await fetchImpl('/room-info', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('room info failed');
      const info = await response.json();
      roomInfo = info;
      channels = Array.isArray(info.channels) ? info.channels : [];
      return info;
    }

    function bindPayloads() {
      connection.subscribe((event) => {
        if (event.type === 'payload') handlePayload(event.payload);
        else emit(event);
      });
    }

    async function startEmbedded() {
      const Embed = EmbedApi;
      if (!Embed) return { redirected: false, embedded: true };
      desiredChannelId = channelIdFromStart || Embed.channelFromSearch(location.search || '');
      const bridge = Embed.createEmbedBridge({
        window: globalThis,
        parent: globalThis.parent,
        ancestors: Embed.ancestorsFrom(globalThis),
        location,
      });
      globalThis.addEventListener?.('message', (event) => bridge.handleMessage(event));
      globalThis.addEventListener?.('pagehide', () => connection.close({ intentional: true }));
      globalThis.addEventListener?.('pageshow', (event) => {
        if (event.persisted) bridge.hello();
      });
      bridge.subscribe(async (event) => {
        if (event.type !== 'identity') return;
        const next = event.identity;
        if (!next.username && !next.identityToken) return;
        identity = {
          username: next.username,
          channelId: desiredChannelId || next.channelId,
          identityToken: next.identityToken || undefined,
          resumeToken: next.resumeToken || undefined,
        };
        if (!roomInfo) {
          try { await loadRoomInfo(); } catch { return; }
          bindPayloads();
        }
        connection.connect(identity);
      });
      const fragmentToken = Embed.consumeFragmentToken?.(globalThis);
      if (fragmentToken) bridge.acceptFragment(fragmentToken, desiredChannelId || Embed.channelFromSearch(location.search || ''));
      bridge.hello();
      return { redirected: false, embedded: true, bridge };
    }

    let channelIdFromStart = '';

    async function start({ channelId } = {}) {
      if (started) return;
      started = true;
      channelIdFromStart = channelId || '';
      if (embedded) return startEmbedded();
      desiredChannelId = channelId || new URLSearchParams(location.search || '').get('channel') || connection.readChannelId();
      const saved = connection.readSession();
      if (!saved) {
        try {
          storage?.setItem(NEXT_KEY, `${location.pathname}${location.search || ''}`);
        } catch { /* ignore */ }
        if (desiredChannelId) connection.writeChannelId(desiredChannelId);
        location.replace('/');
        return { redirected: true };
      }
      await loadRoomInfo();
      identity = {
        username: saved.username,
        resumeToken: saved.token,
        channelId: connection.readChannelId() || desiredChannelId || roomInfo.defaultChannelId
      };
      bindPayloads();
      connection.connect(identity);
      return { redirected: false, roomInfo, channels };
    }

    return {
      connection,
      subscribe,
      start,
      playAction,
      sendMessage,
      switchToChannel,
      leave,
      loadRoomInfo,
      playPageUrl,
      get channels() { return channels; },
      get roomInfo() { return roomInfo; },
      get identity() { return identity; },
      currentChannel,
      embedReturnUrl: () => {
        if (!embedded) return '/';
        const current = channels.find((item) => item.id === desiredChannelId);
        const playDocument = String(location?.pathname || '').includes('/plays/');
        let channelId = desiredChannelId || roomInfo?.defaultChannelId || '';
        if (playDocument || current?.play) {
          const fallback = [roomInfo?.defaultChannelId]
            .concat(channels.filter((item) => item.enabled !== false && !item.play).map((item) => item.id))
            .find((id) => id && id !== desiredChannelId);
          channelId = fallback || '';
        }
        return EmbedApi.withCredential(EmbedApi.embedReturnUrl(channelId), identity?.identityToken);
      },
      embedded: () => embedded,
    };
  }

  return { createPlayClient, playPageUrl, NEXT_KEY };
});
