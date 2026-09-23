'use strict';

const crypto = require('node:crypto');
const { createConversationStore } = require('../storage');
const { createRoomStore } = require('./room');
const { createSessionStore } = require('./session');
const { createMessageStore } = require('./messages');
const { createCommandHandler } = require('./commands');
const events = require('./events');
const { applyRoomOverlay, applyChannelsOverlay, applyModerationOverlay, validatePavilionConfig } = require('../../config');
const { ipDenied } = require('../ip');
const { effectiveFeatures, protocolCapabilities, actorKey } = require('./capabilities');
const { guestsAllowed, publicChannels, userDenied } = require('../identity');

function pavilionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertCatalogTransition(previous, next, { occupancy, playGame }) {
  const nextById = new Map(next.map((channel) => [channel.id, channel]));
  for (const prev of previous) {
    const upcoming = nextById.get(prev.id);
    const members = occupancy[prev.id] || 0;
    if (members > 0 && !upcoming) throw pavilionError('CHANNEL_BUSY', `频道 ${prev.id} 仍有成员，不能删除。`);
    if (members > 0 && prev.enabled && upcoming && !upcoming.enabled) {
      throw pavilionError('CHANNEL_BUSY', `频道 ${prev.id} 仍有成员，不能停用。`);
    }
    const prevPlay = prev.play || '';
    const nextPlay = upcoming?.play || '';
    if (prevPlay !== nextPlay && typeof playGame === 'function' && playGame(prev.id)) {
      throw pavilionError('PLAY_BOUND', `频道 ${prev.id} 有进行中的玩法，不能改绑定。`);
    }
  }
}

// Peers are domain identities, never sockets. The adapter consumes routed effects
// and reports delivery completion/disconnection back through this interface.
function createChatCore(config, runtime = {}) {
  const now = runtime.now || Date.now;
  const cancel = runtime.cancel || clearTimeout;
  const schedule = runtime.schedule || ((fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; });
  const randomId = runtime.randomId || ((prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`);
  const randomResumeToken = runtime.randomResumeToken || (() => crypto.randomBytes(9).toString('base64url'));
  const randomAvatarSeed = runtime.randomAvatarSeed || (() => crypto.randomInt(0, 0x7fffffff));
  const peers = new Map();
  const store = runtime.store || createConversationStore(config, { randomId, now, engine: runtime.engine });
  const governance = runtime.governance || null;
  const rooms = createRoomStore(config, store);
  const publicUser = (session) => events.publicUser(session, config.exposeMemberIps);
  let effects = [];
  let shuttingDown = false;
  function emit(effect) { effects.push(effect); }
  function takeEffects() { const result = effects; effects = []; return result; }
  function timerTask(fn) {
    fn();
    if (runtime.onEffects) runtime.onEffects(takeEffects());
  }
  function broadcast(channelId, payload, except) {
    if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) return false;
    const peerIds = [...peers.values()]
      .filter((peer) => peer !== except && peer.joined && peer.session?.channelId === channelId && !peer.closing)
      .map((peer) => peer.id);
    emit(events.channelEvent(channelId, payload, peerIds));
    return true;
  }
  function broadcastAll(payload, except) {
    if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) return false;
    const peerIds = [...peers.values()]
      .filter((peer) => peer !== except && peer.joined && !peer.closing)
      .map((peer) => peer.id);
    emit({ kind: 'broadcast', payload, peerIds });
    return true;
  }
  const sessionStore = createSessionStore(config, rooms, { now, randomResumeToken, cancel, schedule: (fn, ms) => schedule(() => timerTask(fn), ms) }, publicUser,
    (session) => {
      broadcast(session.channelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: sessionStore.rosterUsers(session.channelId) });
      broadcastOccupancy();
    });
  function occupancySnapshot() {
    return Object.fromEntries(config.channels.map((channel) => [channel.id, sessionStore.activeMembers(channel.id).size]));
  }
  function broadcastOccupancy(except) {
    return broadcastAll({ type: 'channelOccupancy', occupancy: occupancySnapshot() }, except);
  }
  const messageStore = createMessageStore(config);
  const playSlot = { runtime: null };
  function sendJson(peer, payload) { emit(events.directed(peer.id, payload)); }
  function sendError(peer, code, message, clientMessageId, extra = {}) {
    const payload = { type: 'error', code, message };
    if (clientMessageId) payload.clientMessageId = clientMessageId;
    if (extra.clientActionId) payload.clientActionId = extra.clientActionId;
    sendJson(peer, payload);
  }
  function closeClient(peer, code = 1000, reason = '') {
    if (!peer || peer.closing) return;
    peer.closing = true;
    emit({ kind: 'close', peerId: peer.id, code, reason });
  }
  function sendInitialState(peer, session, resumeToken) {
    const channel = rooms.get(session.channelId);
    peer.syncing = true;
    const snapshot = [...channel.messages];
    const latestSeq = channel.messageSequence;
    const playId = channel.config.play;
    const features = effectiveFeatures(channel.config);
    const capabilities = protocolCapabilities(channel.config);
    const identity = { userKey: session.userKey || null, channels: session.grantedChannels };
    const start = {
      type: 'stateStart',
      protocolVersion: events.PROTOCOL_VERSION,
      capabilities,
      features,
      channels: publicChannels(config, identity).map(events.publicChannelSummary),
      roomEpoch: channel.epoch, roomStartedAt: channel.startedAt, latestSeq, resumeToken: resumeToken || null,
      self: publicUser(session), users: sessionStore.rosterUsers(session.channelId), channelId: channel.config.id,
      occupancy: occupancySnapshot()
    };
    if (governance) start.governance = true;
    if (session.muted) start.selfMuted = true;
    if (playId) start.play = { id: playId, page: `/plays/${playId}/` };
    const payloads = [start];
    const history = features.history ? snapshot : [];
    for (const chunk of rooms.historyChunks(channel, history)) payloads.push({ type: 'history', roomEpoch: channel.epoch, messages: chunk });
    payloads.push({ type: 'historyEnd', roomEpoch: channel.epoch, latestSeq });
    if (session.muted) payloads.push({ type: 'moderation', action: 'muted' });
    if (playId && playSlot.runtime) {
      const joined = playSlot.runtime.onJoin(session, channel.epoch);
      for (const snap of joined.snapshots || []) {
        if (snap.visibility === 'private' && snap.actorId && snap.actorId !== actorKey(session)) continue;
        const payload = { ...snap };
        delete payload.actorId;
        payloads.push(payload);
      }
    }
    emit({ kind: 'initial', peerId: peer.id, payloads });
  }
  function deactivateTyping(peer) {
    if (peer.typingTimer) cancel(peer.typingTimer);
    peer.typingTimer = null;
    if (!peer.typingActive || !peer.session) return;
    peer.typingActive = false;
    broadcast(peer.session.channelId, { type: 'typing', userId: peer.session.id, username: peer.session.username, active: false }, peer);
  }
  function activateTyping(peer) {
    if (peer.typingTimer) cancel(peer.typingTimer);
    if (!peer.typingActive) {
      peer.typingActive = true;
      broadcast(peer.session.channelId, { type: 'typing', userId: peer.session.id, username: peer.session.username, active: true }, peer);
    }
    peer.typingTimer = schedule(() => timerTask(() => deactivateTyping(peer)), config.typingTtlMs);
  }
  function handOffSession(session) {
    const oldPeer = session.client;
    if (!oldPeer) return;
    deactivateTyping(oldPeer);
    closeClient(oldPeer, 1000, 'reconnected');
    oldPeer.session = null;
    oldPeer.joined = false;
    session.client = null;
  }
  const handleCommand = createCommandHandler(config, rooms, sessionStore, messageStore,
    { publicUser, sendError, sendJson, broadcast, broadcastOccupancy, sendInitialState, activateTyping, deactivateTyping, closeClient, handOffSession },
    { now, randomId, randomAvatarSeed, cancel, store, playSlot, governance });
  const log = runtime.log || ((line) => { process.stdout.write(`${line}\n`); });
  const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
  function runPrune() {
    const { deleted } = store.pruneExpired(now(), { limit: 500 });
    if (deleted) log(`Storage prune: deleted ${deleted} expired messages`);
    if (deleted === 500) schedule(() => timerTask(runPrune), 0);
  }
  runPrune();
  const pruneTimer = schedule(() => timerTask(runPrune), PRUNE_INTERVAL_MS);
  function connect(peerId, ip = 'unknown') {
    if (shuttingDown || peers.has(peerId)) return false;
    const peer = { id: peerId, ip, session: null, joined: false, closing: false, intentionalLeave: false,
      protocolVersion: null, syncing: false, rates: Object.create(null), typingActive: false, typingTimer: null, joinTimer: null };
    peers.set(peerId, peer);
    peer.joinTimer = schedule(() => timerTask(() => closeClient(peer, 1008, 'join timeout')), config.joinTimeoutMs);
    return true;
  }
  function dispatch(peerId, command) {
    const peer = peers.get(peerId);
    const available = Boolean(peer && !peer.closing);
    if (available) handleCommand(peer, command);
    const result = takeEffects();
    const error = result.find((effect) => effect.kind === 'send' && effect.payload.type === 'error')?.payload;
    return { accepted: available && !error, effects: result, ...(error ? { error } : {}) };
  }
  function disconnect(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return [];
    peers.delete(peerId);
    if (peer.joinTimer) cancel(peer.joinTimer);
    deactivateTyping(peer);
    const session = peer.session;
    if (session && session.client === peer) {
      if (peer.intentionalLeave) playSlot.runtime?.onLeave(session);
      peer.session = null;
      peer.joined = false;
      sessionStore.detach(session, !shuttingDown && !peer.intentionalLeave);
      if (!shuttingDown && peer.intentionalLeave) {
        broadcast(session.channelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: sessionStore.rosterUsers(session.channelId) });
        broadcastOccupancy();
      }
    }
    return takeEffects();
  }
  function connectionStatus(peerId) {
    const peer = peers.get(peerId);
    return peer ? { joined: peer.joined, closing: peer.closing, syncing: peer.syncing, channelId: peer.session?.channelId } : null;
  }
  function completeSync(peerId) { const peer = peers.get(peerId); if (peer) peer.syncing = false; }
  function markClosing(peerId) { const peer = peers.get(peerId); if (peer) peer.closing = true; }
  function shutdown() {
    shuttingDown = true;
    sessionStore.clear();
    if (store.ephemeral) rooms.clear();
    if (pruneTimer) cancel(pruneTimer);
    store.close();
    for (const peer of peers.values()) {
      if (peer.joinTimer) cancel(peer.joinTimer);
      if (peer.typingTimer) cancel(peer.typingTimer);
      peer.intentionalLeave = true;
      closeClient(peer, 1001, 'server stopped');
    }
    return takeEffects();
  }
  function state() {
    const channels = rooms.snapshot();
    return { clients: peers.size, sessions: sessionStore.size(), messages: channels.reduce((n, c) => n + c.messages, 0), roomBytes: channels.reduce((n, c) => n + c.roomBytes, 0), latestSeq: rooms.get(config.defaultChannelId).messageSequence };
  }
  function storageInfo() {
    const sqlite = config.storage?.sqlite;
    return {
      driver: store.driver,
      ephemeral: store.ephemeral,
      ...(store.engine ? { engine: store.engine } : {}),
      ...(sqlite?.path ? { path: sqlite.path } : {}),
      ...(store.driver === 'sqlite' ? { retentionDays: sqlite.retentionDays } : {})
    };
  }
  function roomInfo() {
    const guest = { guest: true, userKey: null, channels: null };
    const visible = publicChannels(config, guest);
    const info = { protocolVersion: events.PROTOCOL_VERSION, deprecatedProtocols: [], roomEpoch: rooms.epoch, roomTitle: config.roomTitle, defaultChannelId: config.defaultChannelId, defaultLanguage: config.defaultLanguage || 'zh-CN', supportedLanguages: ['zh-CN', 'en'], channels: visible.map(events.publicChannel), limits: events.publicLimits(config), ephemeral: store.ephemeral, identity: { guests: guestsAllowed(config) } };
    if (store.driver === 'sqlite') info.retentionDays = config.storage.sqlite.retentionDays;
    if ((config.embedAncestors || []).length || config.embedDirect === true) info.embed = { enabled: true };
    return info;
  }
  function health() {
    const value = state();
    const result = { ok: true, users: value.sessions, messages: value.messages, roomBytes: value.roomBytes, clients: value.clients, ephemeral: store.ephemeral };
    if (typeof store.inventory === 'function') {
      const inventory = store.inventory();
      result.messages = inventory.messages;
      result.storage = {
        driver: store.driver,
        path: config.storage.sqlite.path,
        bytes: inventory.bytes,
        messages: inventory.messages
      };
    }
    return result;
  }
  function occupancy() {
    return occupancySnapshot();
  }

  function applyPavilionConfig({ room, channels, moderation } = {}) {
    const trial = {
      ...config,
      channels: config.channels.map((channel) => ({ ...channel })),
      plays: [...(config.plays || [])],
      operator: config.operator ? { ...config.operator } : config.operator,
      ipDenyList: [...(config.ipDenyList || [])],
      userDenyList: [...(config.userDenyList || [])]
    };
    if (room) applyRoomOverlay(trial, room);
    if (channels) applyChannelsOverlay(trial, channels);
    if (moderation) applyModerationOverlay(trial, moderation);
    validatePavilionConfig(trial);
    assertCatalogTransition(config.channels, trial.channels, {
      occupancy: occupancySnapshot(),
      playGame: (channelId) => playSlot.runtime?.store?.loadGame?.(channelId) || null
    });
    for (const channel of trial.channels) store.ensureChannel(channel.id);
    config.roomTitle = trial.roomTitle;
    config.defaultChannelId = trial.defaultChannelId;
    config.defaultLanguage = trial.defaultLanguage;
    config.exposeMemberIps = trial.exposeMemberIps;
    config.exposeLanUrls = trial.exposeLanUrls;
    config.maxUsers = trial.maxUsers;
    config.channels = trial.channels;
    config.ipDenyList = [...(trial.ipDenyList || [])];
    config.userDenyList = [...(trial.userDenyList || [])];
    rooms.replaceCatalog(trial.channels);
    if (moderation) {
      evictDeniedSeats();
      flushEffects();
    }
  }

  function seatStatus(session) {
    if (session.kind === 'agent') return 'connected';
    return session.client ? 'connected' : 'leased';
  }

  function publicSeat(session, status) {
    return {
      id: session.id,
      username: session.username,
      channelId: session.channelId,
      ip: session.ip || '',
      joinedAt: session.joinedAt,
      lastSpokenAt: session.lastSpokenAt || null,
      messageCount: session.messageCount || 0,
      muted: Boolean(session.muted),
      kind: session.kind === 'agent' ? 'agent' : 'member',
      status: status || seatStatus(session),
      avatarSeed: session.avatarSeed,
      ...(session.userKey ? { userKey: session.userKey } : {})
    };
  }

  function flushEffects() {
    const result = takeEffects();
    if (runtime.onEffects && result.length) runtime.onEffects(result);
    return result;
  }

  function kickSeat(session, options = {}) {
    if (!session || session.kind === 'agent') return false;
    const peer = session.client;
    const channelId = session.channelId;
    const userId = session.id;
    const username = session.username;
    if (peer) {
      sendJson(peer, options.error || { type: 'moderation', action: 'kicked' });
      peer.intentionalLeave = true;
      closeClient(peer, options.code || 4008, options.reason || 'kicked');
    }
    playSlot.runtime?.onLeave(session);
    sessionStore.evict(session);
    broadcast(channelId, { type: 'presence', action: 'leave', userId, username, users: sessionStore.rosterUsers(channelId) });
    broadcastOccupancy();
    return true;
  }

  function evictDeniedSeats() {
    for (const { session } of sessionStore.listSeats()) {
      if (session.kind === 'agent') continue;
      if (ipDenied(config.ipDenyList, session.ip)) kickSeat(session);
      else if (userDenied(config.userDenyList, session.userKey)) {
        kickSeat(session, {
          code: 4011,
          reason: 'user_denied',
          error: { type: 'error', code: 'USER_DENIED', message: '这个身份不能进亭。' }
        });
      }
    }
  }

  function listSeats() {
    return sessionStore.listSeats()
      .map(({ session, status }) => publicSeat(session, status))
      .sort((left, right) => (right.joinedAt || 0) - (left.joinedAt || 0) || left.username.localeCompare(right.username));
  }

  function getSeat(id) {
    const session = sessionStore.findById(id);
    if (!session) return null;
    const listed = sessionStore.listSeats().find((entry) => entry.session === session);
    return publicSeat(session, listed?.status);
  }

  function mute(id, active) {
    const session = sessionStore.findById(id);
    if (!session) return { ok: false, error: 'NOT_FOUND' };
    if (session.kind === 'agent') return { ok: false, error: 'AGENT_SEAT' };
    session.muted = Boolean(active);
    if (session.client) sendJson(session.client, { type: 'moderation', action: session.muted ? 'muted' : 'unmuted' });
    return { ok: true, seat: publicSeat(session), effects: flushEffects() };
  }

  function kick(id) {
    const session = sessionStore.findById(id);
    if (!session) return { ok: false, error: 'NOT_FOUND' };
    if (session.kind === 'agent') return { ok: false, error: 'AGENT_SEAT' };
    const seat = publicSeat(session);
    kickSeat(session);
    return { ok: true, seat, effects: flushEffects() };
  }

  function listSeatMessages(id, query = {}) {
    const session = sessionStore.findById(id);
    if (!session) return { ok: false, error: 'NOT_FOUND' };
    if (typeof store.listMessagesByAuthor !== 'function') {
      return { ok: true, messages: [], exhausted: true };
    }
    const page = store.listMessagesByAuthor(session.id, query);
    return {
      ok: true,
      exhausted: page.exhausted,
      messages: (page.messages || []).map((entry) => ({
        id: entry.message.id,
        seq: entry.message.seq,
        channelId: entry.channelId,
        createdAt: entry.message.createdAt,
        kind: entry.message.kind,
        removed: Boolean(entry.message.removedAt),
        text: entry.message.removedAt ? '' : (typeof entry.message.text === 'string' ? entry.message.text : ''),
        image: !entry.message.removedAt && entry.message.kind === 'image' && entry.message.image
          ? { width: entry.message.image.width, height: entry.message.image.height }
          : null
      }))
    };
  }

  function presentStored(channelId, message) {
    if (!message) return null;
    const quoted = message.replyTo?.id ? store.getMessage(channelId, message.replyTo.id) : null;
    return events.projectMessage(message, { quotedRemoved: Boolean(quoted?.removedAt) });
  }

  function removeMessage(channelId, messageId) {
    const channel = rooms.get(channelId);
    if (!channel || typeof messageId !== 'string') return { ok: false, error: 'NOT_FOUND' };
    let already = false;
    let result;
    try {
      result = store.reviseMessage(channelId, messageId, (message) => {
        if (message.removedAt) {
          already = true;
          return;
        }
        message.removedAt = now();
        delete message.text;
        delete message.image;
        delete message.mentions;
        message.replyTo = null;
        message.reactions = {};
        message.reactionUsers = new Map();
        message.byteSize = Buffer.byteLength(JSON.stringify(events.publicMessage(message)));
      });
    } catch {
      return { ok: false, error: 'STORAGE_UNAVAILABLE' };
    }
    if (!result?.message) return { ok: false, error: 'NOT_FOUND' };
    governance?.markMessageRemoved(channelId, messageId);
    if (!already) {
      broadcast(channelId, {
        type: 'messageRemoved',
        roomEpoch: channel.epoch,
        channelId,
        messageId,
        message: presentStored(channelId, result.message)
      });
      flushEffects();
    }
    return { ok: true, already, message: presentStored(channelId, result.message) };
  }

  function listReports() {
    if (!governance) return [];
    return governance.listOpen().map((report) => {
      const message = store.getMessage(report.channelId, report.messageId);
      const removed = Boolean(message?.removedAt) || !message;
      const text = !message || message.removedAt || typeof message.text !== 'string' ? '' : message.text;
      return {
        id: report.id,
        channelId: report.channelId,
        messageId: report.messageId,
        reporterUsername: report.reporterUsername,
        reporterUserKey: report.reporterUserKey,
        reason: report.reason,
        createdAt: report.createdAt,
        status: report.status,
        removed,
        excerpt: text.slice(0, 80)
      };
    });
  }

  function getReport(id) {
    return governance ? governance.getReport(id) : null;
  }

  function resolveReport(id, status) {
    if (!governance) return null;
    return governance.setStatus(id, status);
  }

  function recordAction(action, detail) {
    governance?.appendAction(action, detail);
  }

  function listActions() {
    if (!governance) return null;
    return governance.listActions(50);
  }

  function attachPlayRuntime(playRuntime) {
    playSlot.runtime = playRuntime || null;
  }
  function roster(channelId) {
    return [...sessionStore.activeMembers(channelId).values()];
  }
  function seatAgent(input) {
    const result = sessionStore.seatAgent({
      ...input,
      id: input.id || randomId('u'),
      avatarSeed: input.avatarSeed ?? randomAvatarSeed()
    });
    if (result.session) {
      broadcast(result.session.channelId, {
        type: 'presence',
        action: 'join',
        user: publicUser(result.session),
        users: sessionStore.rosterUsers(result.session.channelId)
      });
      broadcastOccupancy();
    }
    return result;
  }
  function unseatAgent(token) {
    const session = sessionStore.unseatAgent(token);
    if (session) {
      playSlot.runtime?.onLeave(session);
      broadcast(session.channelId, {
        type: 'presence',
        action: 'leave',
        userId: session.id,
        username: session.username,
        users: sessionStore.rosterUsers(session.channelId)
      });
      broadcastOccupancy();
    }
    return session;
  }
  // A play host speaking for an agent seat: the agent has no peer, so this
  // goes through the command handler's agent path rather than handleMessage.
  function postAsAgent(actorId, text) {
    const session = sessionStore.findByActor(actorId) || sessionStore.findById(actorId);
    if (!session) return { ok: false, code: 'PLAY_POST_REJECTED' };
    const result = handleCommand.postAsSession(session, text);
    if (runtime.onEffects) runtime.onEffects(takeEffects());
    return result;
  }
  function deliverPlayEffects(playEffects) {
    for (const effect of playEffects || []) {
      const payload = { ...effect.payload };
      const actorId = payload.actorId;
      delete payload.actorId;
      if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) continue;
      if (effect.kind === 'broadcast') broadcast(effect.channelId || payload.channelId, payload);
      else {
        const session = sessionStore.findByActor(actorId || effect.actorId) || sessionStore.findById(actorId || effect.actorId);
        if (session?.client) sendJson(session.client, payload);
      }
    }
    if (runtime.onEffects) runtime.onEffects(takeEffects());
  }
  const api = {
    connect, dispatch, disconnect, connectionStatus, completeSync, markClosing, shutdown,
    state, health, roomInfo, storageInfo, pruneDedupe: store.pruneDedupe,
    drainEffects: takeEffects, attachPlayRuntime, roster, seatAgent, unseatAgent, deliverPlayEffects, postAsAgent,
    occupancy, applyPavilionConfig, listSeats, getSeat, mute, kick, listSeatMessages,
    removeMessage, listReports, getReport, resolveReport, recordAction, listActions
  };
  Object.defineProperty(api, 'roomEpoch', { enumerable: true, get: () => rooms.epoch });
  return api;
}
module.exports = { createChatCore };
