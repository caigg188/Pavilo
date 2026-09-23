'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { normalizeIp, isIpAddress, MAX_IP_DENY_LIST } = require('./src/ip');
const { FEATURE_KEYS, defaultFeatures } = require('./src/core/capabilities');

const ROOT = __dirname;
const CONFIG_VERSION = 2;
const SUPPORTED_CONFIG_VERSIONS = Object.freeze([1, 2, 3]);
const MAX_SQLITE_RETENTION_DAYS = 3650;
const MIN_OPERATOR_TOKEN_LENGTH = 16;
const MAX_OPERATOR_TOKEN_LENGTH = 256;
const MIN_IDENTITY_SECRET_LENGTH = 32;
const MAX_IDENTITY_SECRET_LENGTH = 256;
const MAX_IDENTITY_ISSUERS = 1;
const OPERATOR_TOKEN_COMMAND = 'openssl rand -hex 32';
const CHANNEL_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;
const DECIMAL_PORT_RE = /^(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_USERS = 1000;
const MAX_CHANNELS = 100;
const MAX_WELCOME_LENGTH = 2000;
// /room-info carries every channel's welcome text and is refetched on each page
// load, so the per-channel cap alone is not enough to keep that payload small.
const MAX_TOTAL_WELCOME_BYTES = 64 * 1024;
const MAX_MESSAGE_OVERHEAD_BYTES = 16 * 1024;
const MAX_ROSTER_USER_BYTES = 512;
// Files Pavilo serves from its own root. Anything else there (including the YAML
// config) stays private, see assertPrivateConfigPath below.
const HTTP_PUBLIC_FILES = new Set(['index.html', 'chat.css']);
const HTTP_PUBLIC_DIRECTORIES = new Set(['vendor', 'client', 'admin', 'plays']);

const DEFAULTS = deepFreeze({
  port: 4173,
  host: '0.0.0.0',
  maxUsers: 64,
  maxMessages: 300,
  maxTextLength: 2000,
  maxImageBytes: 300_000,
  maxImageDimension: 1600,
  maxImagePixels: 4_000_000,
  maxJsonBytes: 512 * 1024,
  maxWsFrameBytes: 1_572_864,
  maxRoomBytes: 32 * 1024 * 1024,
  maxClients: 80,
  maxClientsPerIp: 12,
  maxWritableBytes: 2 * 1024 * 1024,
  joinTimeoutMs: 12_000,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 75_000,
  typingTtlMs: 4_000,
  sessionLeaseMs: 15_000,
  dedupeTtlMs: 10 * 60_000,
  maxDedupeEntries: 512,
  messageRateLimit: 8,
  reactionRateLimit: 20,
  typingRateLimit: 12,
  rateLimitWindowMs: 5_000,
  allowNoOrigin: true,
  allowedOrigins: [],
  roomTitle: '语亭 · 临时频道',
  defaultChannelId: 'general',
  exposeMemberIps: true,
  exposeLanUrls: true,
  defaultLanguage: 'zh-CN',
  storage: { driver: 'memory' },
  operator: { enabled: false, token: '' },
  gateway: {
    timeoutMs: 30_000,
    maxRetries: 2,
    maxInFlight: 4
  },
  plays: [],
  ipDenyList: [],
  userDenyList: [],
  identity: { guests: true, audience: 'pavilo', clockSkewSec: 60, issuers: [] },
  embedAncestors: [],
  embedDirect: false,
  channels: [{
    id: 'general',
    name: '闲聊',
    description: '轻松聊聊，只留当下。',
    enabled: true,
    readOnly: false,
    maxUsers: 64,
    welcome: '',
    access: 'open',
    features: defaultFeatures()
  },{
    id: 'project',
    name: '项目讨论',
    description: '聚焦项目，高效协作。',
    enabled: true,
    readOnly: false,
    maxUsers: 32,
    welcome: '',
    access: 'open',
    features: defaultFeatures()
  }]
});

const ROOT_KEYS_V1 = new Set(['version', 'server', 'room', 'channels', 'limits', 'timeouts', 'rateLimits', 'identity', 'moderation', 'embed']);
const ROOT_KEYS_V2 = new Set([...ROOT_KEYS_V1, 'storage', 'operator', 'plays']);
const IDENTITY_KEYS = new Set(['guests', 'audience', 'clockSkewSec', 'issuers']);
const ISSUER_KEYS = new Set(['id', 'alg', 'secret']);
const ACCESS_MODES = new Set(['open', 'authenticated']);
const MODERATION_KEYS = new Set(['ipDenyList', 'userDenyList']);
const MODERATION_KEYS_V1 = new Set(['userDenyList']);
const EMBED_KEYS = new Set(['ancestors', 'direct']);
const MAX_EMBED_ANCESTORS = 16;
const MAX_USER_DENY_LIST = 64;
const USER_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const STORAGE_KEYS = new Set(['driver', 'sqlite']);
const OPERATOR_KEYS = new Set(['token']);
const SQLITE_KEYS = new Set(['path', 'engine', 'retentionDays']);
const STORAGE_DRIVERS = new Set(['memory', 'sqlite']);
const SQLITE_ENGINES = new Set(['auto', 'node', 'better-sqlite3']);
const SERVER_KEYS = new Set(['host', 'port', 'maxUsers', 'maxConnections', 'maxConnectionsPerIp', 'allowNoOrigin', 'allowedOrigins']);
const ROOM_KEYS = new Set(['title', 'defaultChannel', 'exposeMemberIps', 'exposeLanUrls', 'defaultLanguage']);
const ROOM_OVERLAY_KEYS = new Set(['title', 'defaultChannel', 'defaultLanguage', 'exposeMemberIps', 'exposeLanUrls', 'maxUsers']);
const CHANNEL_KEYS_V1 = new Set(['id', 'name', 'description', 'enabled', 'readOnly', 'maxUsers', 'welcome', 'access', 'features']);
const CHANNEL_KEYS_V2 = new Set([...CHANNEL_KEYS_V1, 'play']);
const FEATURE_KEY_SET = new Set(FEATURE_KEYS);
const MAX_PLAYS = 32;
const LIMIT_KEYS = new Set(['maxMessagesPerChannel', 'maxTextLength', 'maxImageBytes', 'maxImageDimension', 'maxImagePixels', 'maxJsonBytes', 'maxWebSocketFrameBytes', 'maxChannelBytes', 'maxWritableBytes', 'maxDedupeEntries']);
const TIMEOUT_KEYS = new Set(['joinMs', 'heartbeatIntervalMs', 'heartbeatTimeoutMs', 'typingTtlMs', 'sessionLeaseMs', 'dedupeTtlMs']);
const RATE_KEYS = new Set(['windowMs', 'messages', 'reactions', 'typing']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cloneDefaults() {
  return structuredClone(DEFAULTS);
}

function fail(field, message) {
  throw new Error(`${field}: ${message}`);
}

function record(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, '必须是对象');
  return value;
}

function knownKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key}`, '未知配置项');
  }
}

function integer(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(field, `必须是 ${minimum}–${maximum} 之间的整数`);
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') fail(field, '必须是 true 或 false');
  return value;
}

function text(value, field, minimum, maximum) {
  if (typeof value !== 'string') fail(field, '必须是字符串');
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) fail(field, `长度必须是 ${minimum}–${maximum} 个字符`);
  return result;
}

// Multi-line counterpart of text(). Line endings collapse to \n before the other
// control characters are dropped, so a bare \r never fuses two lines into one.
// Only the outer edges are trimmed: blank lines the deployer wrote on purpose stay.
function paragraph(value, field, minimum, maximum) {
  if (typeof value !== 'string') fail(field, '必须是字符串');
  const result = value.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
  if (result.length < minimum || result.length > maximum) fail(field, `长度必须是 ${minimum}–${maximum} 个字符`);
  return result;
}

function optionalInteger(target, key, source, sourceKey, field, minimum, maximum) {
  if (source[sourceKey] !== undefined) target[key] = integer(source[sourceKey], field, minimum, maximum);
}

function parseOrigins(value, field) {
  if (!Array.isArray(value)) fail(field, '必须是 URL 数组');
  const origins = value.map((entry, index) => {
    const origin = text(entry, `${field}[${index}]`, 1, 2048);
    let parsed;
    try { parsed = new URL(origin); } catch { fail(`${field}[${index}]`, '必须是完整的 http:// 或 https:// Origin'); }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      fail(`${field}[${index}]`, '必须是不含路径的 http:// 或 https:// Origin');
    }
    return origin;
  });
  if (new Set(origins).size !== origins.length) fail(field, '不能包含重复 Origin');
  return origins;
}

function assertPlayInstalled(playId, field) {
  if (!CHANNEL_ID_RE.test(playId)) fail(field, '只能使用小写字母、数字、下划线和连字符，且必须以字母或数字开头');
  const directory = path.join(ROOT, 'plays', playId);
  if (!fs.existsSync(path.join(directory, 'play.json'))) fail(field, `找不到 plays/${playId}/play.json`);
  if (!fs.existsSync(path.join(directory, 'host.js'))) fail(field, `找不到 plays/${playId}/host.js`);
  if (!fs.existsSync(path.join(directory, 'page', 'index.html'))) fail(field, `找不到 plays/${playId}/page/index.html`);
}

function parsePlays(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('plays', '必须是字符串数组');
  if (value.length > MAX_PLAYS) fail('plays', `最多 ${MAX_PLAYS} 个玩法`);
  const ids = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const field = `plays[${index}]`;
    const id = text(value[index], field, 1, 32);
    if (seen.has(id)) fail(field, `玩法 ID “${id}” 重复`);
    assertPlayInstalled(id, field);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseFeatures(value, field) {
  if (value === undefined) return defaultFeatures();
  const features = record(value, field);
  knownKeys(features, FEATURE_KEY_SET, field);
  const parsed = defaultFeatures();
  for (const key of FEATURE_KEYS) {
    if (features[key] !== undefined) parsed[key] = boolean(features[key], `${field}.${key}`);
  }
  return parsed;
}

function parseAccess(value, field) {
  if (value === undefined) return 'open';
  const access = text(value, field, 1, 32);
  if (!ACCESS_MODES.has(access)) fail(field, '只能是 open 或 authenticated');
  return access;
}

function parseIdentitySecret(value, field) {
  if (value === undefined) return '';
  const secret = secretText(value, field, 0, MAX_IDENTITY_SECRET_LENGTH);
  if (secret.length === 0) return '';
  if (/\s/.test(secret)) fail(field, '不能包含空白字符');
  if (secret.length < MIN_IDENTITY_SECRET_LENGTH) {
    fail(field, `长度必须是 ${MIN_IDENTITY_SECRET_LENGTH}–${MAX_IDENTITY_SECRET_LENGTH} 个字符`);
  }
  return secret;
}

function parseEmbed(value) {
  if (value === undefined) return { ancestors: [], direct: false };
  const embed = record(value, 'embed');
  knownKeys(embed, EMBED_KEYS, 'embed');
  const direct = embed.direct === undefined ? false : boolean(embed.direct, 'embed.direct');
  if (embed.ancestors === undefined) return { ancestors: [], direct };
  if (!Array.isArray(embed.ancestors)) fail('embed.ancestors', '必须是 URL 数组');
  if (embed.ancestors.length > MAX_EMBED_ANCESTORS) fail('embed.ancestors', `最多 ${MAX_EMBED_ANCESTORS} 个来源`);
  const origins = parseOrigins(embed.ancestors, 'embed.ancestors');
  for (const origin of origins) {
    if (origin.includes('*')) fail('embed.ancestors', '不能使用通配');
  }
  return { ancestors: origins, direct };
}

function parseIdentity(value) {
  if (value === undefined) return { guests: true, audience: 'pavilo', clockSkewSec: 60, issuers: [] };
  const identity = record(value, 'identity');
  knownKeys(identity, IDENTITY_KEYS, 'identity');
  const guests = identity.guests === undefined ? true : boolean(identity.guests, 'identity.guests');
  const audience = identity.audience === undefined ? 'pavilo' : text(identity.audience, 'identity.audience', 1, 64);
  const clockSkewSec = identity.clockSkewSec === undefined
    ? 60
    : integer(identity.clockSkewSec, 'identity.clockSkewSec', 0, 300);
  if (identity.issuers === undefined) {
    return { guests, audience, clockSkewSec, issuers: [] };
  }
  if (!Array.isArray(identity.issuers)) fail('identity.issuers', '必须是数组');
  if (identity.issuers.length > MAX_IDENTITY_ISSUERS) fail('identity.issuers', `最多 ${MAX_IDENTITY_ISSUERS} 个签发方`);
  const issuers = identity.issuers.map((entry, index) => {
    const field = `identity.issuers[${index}]`;
    const issuer = record(entry, field);
    knownKeys(issuer, ISSUER_KEYS, field);
    const id = text(issuer.id, `${field}.id`, 1, 32);
    if (!/^[A-Za-z0-9._:-]+$/.test(id)) fail(`${field}.id`, '只能使用字母、数字、点、下划线、冒号和连字符');
    const alg = issuer.alg === undefined ? 'HS256' : text(issuer.alg, `${field}.alg`, 1, 16);
    if (alg !== 'HS256') fail(`${field}.alg`, '当前只支持 HS256');
    return { id, alg, secret: parseIdentitySecret(issuer.secret, `${field}.secret`) };
  });
  const ids = new Set();
  for (const issuer of issuers) {
    if (ids.has(issuer.id)) fail('identity.issuers', `签发方 “${issuer.id}” 重复`);
    ids.add(issuer.id);
  }
  return { guests, audience, clockSkewSec, issuers };
}

function identityUsable(config) {
  return (config.identity?.issuers || []).some((issuer) => issuer.alg === 'HS256' && issuer.secret.length >= MIN_IDENTITY_SECRET_LENGTH);
}

function identityDeclared(config) {
  return (config.identity?.issuers || []).length > 0;
}

function validateIdentity(config, { requireSecrets = true } = {}) {
  const guests = config.identity?.guests !== false;
  const hasAuthenticated = (config.channels || []).some((channel) => channel.access === 'authenticated');
  const ready = identityUsable(config);
  const present = requireSecrets ? ready : ready || identityDeclared(config);
  if (hasAuthenticated && !present) {
    fail('identity.issuers', 'access: authenticated 需要配置可用的 identity.issuers');
  }
  if (!guests && !present) {
    fail('identity.guests', '关闭访客时必须配置可用的 identity.issuers');
  }
  if (guests) {
    const defaultChannel = (config.channels || []).find((channel) => channel.id === config.defaultChannelId);
    if (defaultChannel?.access === 'authenticated') {
      fail('room.defaultChannel', '访客开启时默认频道必须是 access: open');
    }
  }
}

function normalizeChannels(value, maxUsers, { schemaVersion, plays, clampMaxUsers = false } = {}) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHANNELS) fail('channels', `必须包含 1–${MAX_CHANNELS} 个频道`);
  const ids = new Set();
  const enabledPlays = plays || [];
  const channels = value.map((entry, index) => {
    const field = `channels[${index}]`;
    const channel = record(entry, field);
    knownKeys(channel, schemaVersion >= 2 ? CHANNEL_KEYS_V2 : CHANNEL_KEYS_V1, field);
    const id = text(channel.id, `${field}.id`, 1, 32);
    if (!CHANNEL_ID_RE.test(id)) fail(`${field}.id`, '只能使用小写字母、数字、下划线和连字符，且必须以字母或数字开头');
    if (ids.has(id)) fail(`${field}.id`, `频道 ID “${id}” 重复`);
    ids.add(id);
    let play;
    if (channel.play !== undefined && channel.play !== '') {
      play = text(channel.play, `${field}.play`, 1, 32);
      if (!enabledPlays.includes(play)) fail(`${field}.play`, `玩法 “${play}” 未在 plays 中启用`);
    }
    let channelMaxUsers;
    if (channel.maxUsers === undefined) channelMaxUsers = maxUsers;
    else if (clampMaxUsers) channelMaxUsers = Math.min(maxUsers, integer(channel.maxUsers, `${field}.maxUsers`, 1, MAX_USERS));
    else channelMaxUsers = integer(channel.maxUsers, `${field}.maxUsers`, 1, maxUsers);
    return {
      id,
      name: text(channel.name, `${field}.name`, 1, 40),
      description: channel.description === undefined ? '' : text(channel.description, `${field}.description`, 0, 160),
      enabled: channel.enabled === undefined ? true : boolean(channel.enabled, `${field}.enabled`),
      readOnly: channel.readOnly === undefined ? false : boolean(channel.readOnly, `${field}.readOnly`),
      maxUsers: channelMaxUsers,
      welcome: channel.welcome === undefined ? '' : paragraph(channel.welcome, `${field}.welcome`, 0, MAX_WELCOME_LENGTH),
      access: parseAccess(channel.access, `${field}.access`),
      features: parseFeatures(channel.features, `${field}.features`),
      ...(play ? { play } : {})
    };
  });
  if (!channels.some((channel) => channel.enabled && !channel.readOnly)) fail('channels', '至少要启用一个可发言的频道');
  return channels;
}

function snapshotRoomSection(config) {
  return {
    title: config.roomTitle,
    defaultChannel: config.defaultChannelId,
    defaultLanguage: config.defaultLanguage || 'zh-CN',
    exposeMemberIps: config.exposeMemberIps !== false,
    exposeLanUrls: config.exposeLanUrls !== false,
    maxUsers: config.maxUsers
  };
}

function snapshotChannelsSection(config) {
  return (config.channels || []).map((channel) => {
    const copy = {
      id: channel.id,
      name: channel.name,
      description: channel.description || '',
      enabled: channel.enabled !== false,
      readOnly: Boolean(channel.readOnly),
      maxUsers: channel.maxUsers,
      welcome: channel.welcome || ''
    };
    if (channel.play) copy.play = channel.play;
    copy.access = channel.access === 'authenticated' ? 'authenticated' : 'open';
    copy.features = { ...defaultFeatures(), ...(channel.features || {}) };
    return copy;
  });
}

function parseRoomOverlay(input) {
  const room = record(input, 'room');
  knownKeys(room, ROOM_OVERLAY_KEYS, 'room');
  for (const key of ROOM_OVERLAY_KEYS) {
    if (room[key] === undefined) fail(`room.${key}`, '管理页覆盖层缺少字段');
  }
  const language = text(room.defaultLanguage, 'room.defaultLanguage', 2, 16);
  if (language !== 'zh-CN' && language !== 'en') fail('room.defaultLanguage', '只能是 zh-CN 或 en');
  return {
    title: text(room.title, 'room.title', 1, 80),
    defaultChannel: text(room.defaultChannel, 'room.defaultChannel', 1, 32),
    defaultLanguage: language,
    exposeMemberIps: boolean(room.exposeMemberIps, 'room.exposeMemberIps'),
    exposeLanUrls: boolean(room.exposeLanUrls, 'room.exposeLanUrls'),
    maxUsers: integer(room.maxUsers, 'room.maxUsers', 1, MAX_USERS)
  };
}

function parseChannelsOverlay(value, maxUsers, { plays } = {}) {
  return normalizeChannels(value, maxUsers, { schemaVersion: 2, plays, clampMaxUsers: true });
}

function applyRoomOverlay(config, room) {
  const parsed = room.title !== undefined && room.maxUsers !== undefined ? parseRoomOverlay(room) : room;
  if (parsed.maxUsers > config.maxClients) {
    fail('room.maxUsers', `不能大于 server.maxConnections（当前 ${config.maxClients}）`);
  }
  config.roomTitle = parsed.title;
  config.defaultChannelId = parsed.defaultChannel;
  config.defaultLanguage = parsed.defaultLanguage;
  config.exposeMemberIps = parsed.exposeMemberIps;
  config.exposeLanUrls = parsed.exposeLanUrls;
  config.maxUsers = parsed.maxUsers;
  config.channels = config.channels.map((channel) => ({
    ...channel,
    description: channel.description || '',
    enabled: channel.enabled !== false,
    readOnly: Boolean(channel.readOnly),
    welcome: channel.welcome || '',
    maxUsers: Math.min(channel.maxUsers, config.maxUsers)
  }));
  return parsed;
}

function applyChannelsOverlay(config, channels) {
  config.channels = parseChannelsOverlay(channels, config.maxUsers, { plays: config.plays });
  return config.channels;
}

function parseIpDenyList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(field, '必须是数组');
  if (value.length > MAX_IP_DENY_LIST) fail(field, `最多 ${MAX_IP_DENY_LIST} 条`);
  const seen = new Set();
  const list = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') fail(`${field}[${index}]`, '必须是字符串');
    const ip = normalizeIp(entry);
    if (!isIpAddress(ip)) fail(`${field}[${index}]`, '必须是 IPv4 或 IPv6 地址');
    if (seen.has(ip)) return;
    seen.add(ip);
    list.push(ip);
  });
  return list;
}

function parseUserDenyList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(field, '必须是数组');
  if (value.length > MAX_USER_DENY_LIST) fail(field, `最多 ${MAX_USER_DENY_LIST} 条`);
  const seen = new Set();
  const list = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !USER_KEY_RE.test(entry)) fail(`${field}[${index}]`, '必须是稳定用户标识');
    if (seen.has(entry)) return;
    seen.add(entry);
    list.push(entry);
  });
  return list;
}

function snapshotModerationSection(config) {
  return {
    ipDenyList: [...(config.ipDenyList || [])],
    userDenyList: [...(config.userDenyList || [])]
  };
}

function parseModerationOverlay(input) {
  const moderation = record(input, 'moderation');
  knownKeys(moderation, MODERATION_KEYS, 'moderation');
  if (moderation.ipDenyList === undefined) fail('moderation.ipDenyList', '管理页覆盖层缺少字段');
  return {
    ipDenyList: parseIpDenyList(moderation.ipDenyList, 'moderation.ipDenyList'),
    userDenyList: parseUserDenyList(moderation.userDenyList, 'moderation.userDenyList')
  };
}

function applyModerationOverlay(config, moderation) {
  const parsed = parseModerationOverlay(moderation);
  config.ipDenyList = parsed.ipDenyList;
  config.userDenyList = parsed.userDenyList;
  return parsed;
}

function moderationSectionsEqual(left, right) {
  return JSON.stringify(left?.ipDenyList || []) === JSON.stringify(right?.ipDenyList || [])
    && JSON.stringify(left?.userDenyList || []) === JSON.stringify(right?.userDenyList || []);
}

function validateDefaultChannel(config) {
  const defaultChannel = config.channels.find((channel) => channel.id === config.defaultChannelId);
  if (!defaultChannel) fail('room.defaultChannel', `找不到频道 “${config.defaultChannelId}”`);
  if (!defaultChannel.enabled) fail('room.defaultChannel', '默认频道必须启用');
  if (defaultChannel.readOnly) fail('room.defaultChannel', '默认频道不能是只读频道');
}

function validatePavilionConfig(config) {
  validateDefaultChannel(config);
  validateCrossConstraints(config);
}

function roomSectionsEqual(left, right) {
  return left.title === right.title
    && left.defaultChannel === right.defaultChannel
    && left.defaultLanguage === right.defaultLanguage
    && left.exposeMemberIps === right.exposeMemberIps
    && left.exposeLanUrls === right.exposeLanUrls
    && left.maxUsers === right.maxUsers;
}

function channelsEqual(left, right) {
  return JSON.stringify(snapshotChannelsSection({ channels: left })) === JSON.stringify(snapshotChannelsSection({ channels: right }));
}

function mergePavilionOverlay(config, overlay = {}) {
  const warnings = [];
  const sources = { room: 'yaml', channels: 'yaml', moderation: 'yaml' };
  const yamlRoom = snapshotRoomSection(config);
  const yamlChannels = snapshotChannelsSection(config);
  const yamlModeration = snapshotModerationSection(config);
  if (overlay.room) {
    const room = parseRoomOverlay(overlay.room);
    if (!roomSectionsEqual(yamlRoom, room)) {
      warnings.push('房间设置已由管理页接管，忽略配置文件中的 room / server.maxUsers');
    }
    applyRoomOverlay(config, room);
    sources.room = 'operator';
  }
  if (overlay.channels) {
    const channels = parseChannelsOverlay(overlay.channels, config.maxUsers, { plays: config.plays });
    if (!channelsEqual(yamlChannels, channels)) {
      warnings.push('聊天频道已由管理页接管，忽略配置文件中的 channels');
    }
    applyChannelsOverlay(config, channels);
    sources.channels = 'operator';
  }
  if (overlay.moderation) {
    const moderation = parseModerationOverlay(overlay.moderation);
    if (!moderationSectionsEqual(yamlModeration, moderation)) {
      warnings.push('门禁已由管理页接管，忽略配置文件中的 moderation');
    }
    applyModerationOverlay(config, moderation);
    sources.moderation = 'operator';
  }
  if (overlay.room || overlay.channels) validatePavilionConfig(config);
  return { sources, warnings };
}

function rootKeysFor(schemaVersion) {
  return schemaVersion >= 2 ? ROOT_KEYS_V2 : ROOT_KEYS_V1;
}

function secretText(value, field, minimum, maximum) {
  if (typeof value !== 'string') fail(field, '必须是字符串');
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(value)) fail(field, '不能包含控制字符');
  if (value.length < minimum || value.length > maximum) fail(field, `长度必须是 ${minimum}–${maximum} 个字符`);
  return value;
}

function parseOperatorToken(value, field) {
  if (value === undefined) return '';
  const token = secretText(value, field, 0, MAX_OPERATOR_TOKEN_LENGTH);
  if (token.length === 0) return '';
  if (/\s/.test(token)) fail(field, '不能包含空白字符');
  if (token.length < MIN_OPERATOR_TOKEN_LENGTH) {
    fail(field, `长度必须是 ${MIN_OPERATOR_TOKEN_LENGTH}–${MAX_OPERATOR_TOKEN_LENGTH} 个字符；推荐 openssl rand -hex 32`);
  }
  return token;
}

function parseOperator(value) {
  if (value === undefined) return { enabled: false, token: '' };
  const operator = record(value, 'operator');
  knownKeys(operator, OPERATOR_KEYS, 'operator');
  return { enabled: false, token: parseOperatorToken(operator.token, 'operator.token') };
}

function operatorConsoleEnabled(config) {
  return config.storage?.driver === 'sqlite' && (config.operator?.token || '').length >= MIN_OPERATOR_TOKEN_LENGTH;
}

function finalizeOperator(config) {
  config.operator.enabled = operatorConsoleEnabled(config);
  return config;
}

function sqliteOperatorNotice(config) {
  if (config.storage?.driver !== 'sqlite') return null;
  if (operatorConsoleEnabled(config)) return null;
  return [
    'SQLite 已启用，但未配置 operator.token，无法打开 /admin，也无法配置模型渠道。',
    `生成口令：${OPERATOR_TOKEN_COMMAND}`,
    '在 version: 2 的配置里写入 operator.token，或设置环境变量 PAVILO_OPERATOR_TOKEN。'
  ].join('\n');
}

function applySecretEnv(config, env) {
  if (typeof env.PAVILO_OPERATOR_TOKEN === 'string' && env.PAVILO_OPERATOR_TOKEN !== '') {
    config.operator.token = parseOperatorToken(env.PAVILO_OPERATOR_TOKEN, 'PAVILO_OPERATOR_TOKEN');
  }
  if (typeof env.PAVILO_IDENTITY_SECRET === 'string' && env.PAVILO_IDENTITY_SECRET !== '') {
    const secret = parseIdentitySecret(env.PAVILO_IDENTITY_SECRET, 'PAVILO_IDENTITY_SECRET');
    const issuers = config.identity?.issuers || [];
    if (issuers.length !== 1) fail('PAVILO_IDENTITY_SECRET', '覆盖密钥时 identity.issuers 必须恰好有一项');
    issuers[0].secret = secret;
  }
  finalizeOperator(config);
  validateIdentity(config);
}

function parseRetentionDays(value, field) {
  if (value === undefined) return 30;
  if (value === null || value === 'forever') return null;
  if (value === 0) fail(field, '不能为 0；永久留存请使用 null 或 forever');
  return integer(value, field, 1, MAX_SQLITE_RETENTION_DAYS);
}

function assertPrivateSqlitePath(resolvedPath, field) {
  if (isHttpPublicPath(resolvedPath, ROOT)) fail(field, '不能位于 Pavilo 的 HTTP 公开路径（index.html、vendor/ 或 client/）');
  try {
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) fail(field, '必须是数据库文件路径，不能是目录');
      const realPath = fs.realpathSync(resolvedPath);
      const realRoot = fs.realpathSync(ROOT);
      if (isHttpPublicPath(realPath, realRoot)) fail(field, '不能位于 Pavilo 的 HTTP 公开路径（index.html、vendor/ 或 client/）');
    }
  } catch (error) {
    if (error.message.startsWith(`${field}:`)) throw error;
  }
}

function parseStorage(value, baseDir) {
  if (value === undefined) return { driver: 'memory' };
  const storage = record(value, 'storage');
  knownKeys(storage, STORAGE_KEYS, 'storage');
  const driver = storage.driver === undefined ? 'memory' : text(storage.driver, 'storage.driver', 1, 32);
  if (!STORAGE_DRIVERS.has(driver)) fail('storage.driver', '只能是 memory 或 sqlite');
  if (driver === 'memory') {
    if (storage.sqlite !== undefined) fail('storage.sqlite', '仅在 storage.driver 为 sqlite 时可用');
    return { driver: 'memory' };
  }
  if (storage.sqlite === undefined) fail('storage.sqlite', '必须提供');
  const sqlite = record(storage.sqlite, 'storage.sqlite');
  knownKeys(sqlite, SQLITE_KEYS, 'storage.sqlite');
  if (sqlite.path === undefined) fail('storage.sqlite.path', '必须提供');
  const resolvedPath = path.resolve(baseDir, text(sqlite.path, 'storage.sqlite.path', 1, 4096));
  assertPrivateSqlitePath(resolvedPath, 'storage.sqlite.path');
  const engine = sqlite.engine === undefined ? 'auto' : text(sqlite.engine, 'storage.sqlite.engine', 1, 32);
  if (!SQLITE_ENGINES.has(engine)) fail('storage.sqlite.engine', '只能是 auto、node 或 better-sqlite3');
  return {
    driver: 'sqlite',
    sqlite: {
      path: resolvedPath,
      engine,
      retentionDays: parseRetentionDays(sqlite.retentionDays, 'storage.sqlite.retentionDays')
    }
  };
}

function validateCrossConstraints(config) {
  const maxTextBytes = config.maxTextLength * 4;
  const encodedImageBytes = Math.ceil(config.maxImageBytes / 3) * 4;
  // A reply embeds the original text preview, so a message envelope may contain
  // both its own largest body and another maximum-length text value.
  const largestMessageBytes = Math.max(maxTextBytes, encodedImageBytes) + maxTextBytes + MAX_MESSAGE_OVERHEAD_BYTES;
  const rosterBytes = config.maxUsers * MAX_ROSTER_USER_BYTES + MAX_MESSAGE_OVERHEAD_BYTES;
  const welcomeBytes = config.channels.reduce((total, channel) => total + Buffer.byteLength(channel.welcome || '', 'utf8'), 0);
  if (config.maxClients < config.maxUsers) fail('server.maxConnections', '不能小于 server.maxUsers');
  if (config.maxClientsPerIp > config.maxClients) fail('server.maxConnectionsPerIp', '不能大于 server.maxConnections');
  if (config.maxJsonBytes < largestMessageBytes) fail('limits.maxJsonBytes', '装不下最大图片的 base64 或最长文字消息及其 JSON 开销');
  if (config.maxJsonBytes < rosterBytes) fail('limits.maxJsonBytes', '装不下 server.maxUsers 对应的成员列表 JSON');
  if (config.maxWsFrameBytes < config.maxJsonBytes) fail('limits.maxWebSocketFrameBytes', '不能小于 limits.maxJsonBytes');
  if (config.maxWritableBytes < config.maxJsonBytes + 14) fail('limits.maxWritableBytes', '必须能容纳一个最大 JSON WebSocket 帧及帧头');
  if (config.maxRoomBytes < largestMessageBytes) fail('limits.maxChannelBytes', '装不下一条最大图片或文字消息');
  if (config.heartbeatTimeoutMs <= config.heartbeatIntervalMs) fail('timeouts.heartbeatTimeoutMs', '必须大于 timeouts.heartbeatIntervalMs');
  if (welcomeBytes > MAX_TOTAL_WELCOME_BYTES) fail('channels', `所有频道 welcome 合计不能超过 ${MAX_TOTAL_WELCOME_BYTES} 字节`);
  const sqlite = config.storage?.driver === 'sqlite';
  if (!sqlite && (config.operator?.token || config._operatorDeclared)) {
    fail('operator', '管理页需要 storage.driver: sqlite');
  }
  const usesPlay = (config.plays || []).length > 0 || config.channels.some((channel) => channel.play);
  if (usesPlay && !sqlite) fail('plays', '玩法需要 storage.driver: sqlite');
  if (config.operator?.token && identityUsable(config)) {
    for (const issuer of config.identity.issuers) {
      if (issuer.secret && issuer.secret === config.operator.token) {
        fail('identity.issuers', '不能与 operator.token 使用同一密钥');
      }
    }
  }
  validateIdentity(config, { requireSecrets: false });
}

function normalizeConfig(document = {}, { requireVersion = false, baseDir = ROOT } = {}) {
  const root = record(document, 'config');
  if (requireVersion && root.version === undefined) fail('version', '配置文件必须声明 version: 1 或 2（3 视为 2）');
  if (root.version !== undefined && !SUPPORTED_CONFIG_VERSIONS.includes(root.version)) {
    fail('version', '当前只支持版本 1 或 2（3 视为 2）');
  }
  const schemaVersion = root.version === undefined ? 1 : root.version;
  knownKeys(root, rootKeysFor(schemaVersion), 'config');

  const server = record(root.server, 'server');
  const room = record(root.room, 'room');
  const limits = record(root.limits, 'limits');
  const timeouts = record(root.timeouts, 'timeouts');
  const rateLimits = record(root.rateLimits, 'rateLimits');
  knownKeys(server, SERVER_KEYS, 'server');
  knownKeys(room, ROOM_KEYS, 'room');
  knownKeys(limits, LIMIT_KEYS, 'limits');
  knownKeys(timeouts, TIMEOUT_KEYS, 'timeouts');
  knownKeys(rateLimits, RATE_KEYS, 'rateLimits');

  const config = cloneDefaults();
  if (server.host !== undefined) config.host = text(server.host, 'server.host', 1, 255);
  optionalInteger(config, 'port', server, 'port', 'server.port', 1, 65_535);
  optionalInteger(config, 'maxUsers', server, 'maxUsers', 'server.maxUsers', 1, MAX_USERS);
  optionalInteger(config, 'maxClients', server, 'maxConnections', 'server.maxConnections', 1, 2000);
  optionalInteger(config, 'maxClientsPerIp', server, 'maxConnectionsPerIp', 'server.maxConnectionsPerIp', 1, 2000);
  if (server.maxConnections !== undefined && server.maxConnectionsPerIp === undefined) {
    config.maxClientsPerIp = Math.min(config.maxClientsPerIp, config.maxClients);
  }
  if (server.allowNoOrigin !== undefined) config.allowNoOrigin = boolean(server.allowNoOrigin, 'server.allowNoOrigin');
  if (server.allowedOrigins !== undefined) config.allowedOrigins = parseOrigins(server.allowedOrigins, 'server.allowedOrigins');

  if (room.title !== undefined) config.roomTitle = text(room.title, 'room.title', 1, 80);
  if (room.defaultChannel !== undefined) config.defaultChannelId = text(room.defaultChannel, 'room.defaultChannel', 1, 32);
  if (room.exposeMemberIps !== undefined) config.exposeMemberIps = boolean(room.exposeMemberIps, 'room.exposeMemberIps');
  if (room.exposeLanUrls !== undefined) config.exposeLanUrls = boolean(room.exposeLanUrls, 'room.exposeLanUrls');
  if (room.defaultLanguage !== undefined) {
    const language = text(room.defaultLanguage, 'room.defaultLanguage', 2, 16);
    if (language !== 'zh-CN' && language !== 'en') fail('room.defaultLanguage', '只能是 zh-CN 或 en');
    config.defaultLanguage = language;
  }

  optionalInteger(config, 'maxMessages', limits, 'maxMessagesPerChannel', 'limits.maxMessagesPerChannel', 1, 10_000);
  optionalInteger(config, 'maxTextLength', limits, 'maxTextLength', 'limits.maxTextLength', 1, 100_000);
  optionalInteger(config, 'maxImageBytes', limits, 'maxImageBytes', 'limits.maxImageBytes', 1, 32 * 1024 * 1024);
  optionalInteger(config, 'maxImageDimension', limits, 'maxImageDimension', 'limits.maxImageDimension', 1, 16_384);
  optionalInteger(config, 'maxImagePixels', limits, 'maxImagePixels', 'limits.maxImagePixels', 1, 100_000_000);
  optionalInteger(config, 'maxJsonBytes', limits, 'maxJsonBytes', 'limits.maxJsonBytes', 1024, 64 * 1024 * 1024);
  optionalInteger(config, 'maxWsFrameBytes', limits, 'maxWebSocketFrameBytes', 'limits.maxWebSocketFrameBytes', 1024, 64 * 1024 * 1024);
  optionalInteger(config, 'maxRoomBytes', limits, 'maxChannelBytes', 'limits.maxChannelBytes', 1024, 512 * 1024 * 1024);
  optionalInteger(config, 'maxWritableBytes', limits, 'maxWritableBytes', 'limits.maxWritableBytes', 1024, 128 * 1024 * 1024);
  optionalInteger(config, 'maxDedupeEntries', limits, 'maxDedupeEntries', 'limits.maxDedupeEntries', 1, 100_000);

  optionalInteger(config, 'joinTimeoutMs', timeouts, 'joinMs', 'timeouts.joinMs', 100, 3_600_000);
  optionalInteger(config, 'heartbeatIntervalMs', timeouts, 'heartbeatIntervalMs', 'timeouts.heartbeatIntervalMs', 100, 3_600_000);
  optionalInteger(config, 'heartbeatTimeoutMs', timeouts, 'heartbeatTimeoutMs', 'timeouts.heartbeatTimeoutMs', 100, 3_600_000);
  optionalInteger(config, 'typingTtlMs', timeouts, 'typingTtlMs', 'timeouts.typingTtlMs', 100, 3_600_000);
  optionalInteger(config, 'sessionLeaseMs', timeouts, 'sessionLeaseMs', 'timeouts.sessionLeaseMs', 0, 3_600_000);
  optionalInteger(config, 'dedupeTtlMs', timeouts, 'dedupeTtlMs', 'timeouts.dedupeTtlMs', 1000, 86_400_000);

  optionalInteger(config, 'rateLimitWindowMs', rateLimits, 'windowMs', 'rateLimits.windowMs', 100, 3_600_000);
  optionalInteger(config, 'messageRateLimit', rateLimits, 'messages', 'rateLimits.messages', 1, 10_000);
  optionalInteger(config, 'reactionRateLimit', rateLimits, 'reactions', 'rateLimits.reactions', 1, 10_000);
  optionalInteger(config, 'typingRateLimit', rateLimits, 'typing', 'rateLimits.typing', 1, 10_000);

  config.plays = schemaVersion >= 2 ? parsePlays(root.plays) : [];
  if (root.channels === undefined) {
    config.channels = config.channels.map((channel) => ({
      ...channel,
      maxUsers: Math.min(channel.maxUsers, config.maxUsers),
      access: channel.access || 'open',
      features: { ...defaultFeatures(), ...(channel.features || {}) }
    }));
  } else {
    config.channels = normalizeChannels(root.channels, config.maxUsers, { schemaVersion, plays: config.plays });
  }
  validateDefaultChannel(config);
  config.identity = parseIdentity(root.identity);
  const embed = parseEmbed(root.embed);
  config.embedAncestors = embed.ancestors;
  config.embedDirect = embed.direct;
  config.storage = schemaVersion >= 2 ? parseStorage(root.storage, baseDir) : { driver: 'memory' };
  if (schemaVersion >= 2) config.operator = parseOperator(root.operator);
  if (root.operator !== undefined) config._operatorDeclared = true;
  if (root.moderation !== undefined) {
    const moderation = record(root.moderation, 'moderation');
    if (schemaVersion >= 2) {
      knownKeys(moderation, MODERATION_KEYS, 'moderation');
      config.ipDenyList = parseIpDenyList(moderation.ipDenyList, 'moderation.ipDenyList');
      config.userDenyList = parseUserDenyList(moderation.userDenyList, 'moderation.userDenyList');
    } else {
      knownKeys(moderation, MODERATION_KEYS_V1, 'moderation');
      config.userDenyList = parseUserDenyList(moderation.userDenyList, 'moderation.userDenyList');
    }
  }
  finalizeOperator(config);
  validateCrossConstraints(config);
  delete config._operatorDeclared;
  return config;
}

function parseConfig(source, filename = 'pavilo.yaml') {
  if (typeof source !== 'string' && !Buffer.isBuffer(source)) fail(filename, '配置内容必须是字符串或 Buffer');
  if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) throw new Error(`${filename}: 配置文件不能超过 ${MAX_CONFIG_BYTES} 字节`);
  let document;
  try {
    document = YAML.parseDocument(source.toString(), { schema: 'core', strict: true, stringKeys: true, uniqueKeys: true });
    if (document.errors.length) throw document.errors[0];
    if (document.warnings.length) throw document.warnings[0];
    let hasAlias = false;
    YAML.visit(document, { Alias() { hasAlias = true; } });
    if (hasAlias) throw new Error('不允许使用 YAML 锚点别名');
    document = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`${filename}: YAML 解析失败：${error.message}`);
  }
  try {
    const baseDir = path.isAbsolute(filename) ? path.dirname(filename) : ROOT;
    return normalizeConfig(document, { requireVersion: true, baseDir });
  } catch (error) {
    throw new Error(`${filename}: ${error.message}`);
  }
}

function isHttpPublicPath(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const firstPart = relative.split(path.sep)[0];
  return HTTP_PUBLIC_DIRECTORIES.has(firstPart) || HTTP_PUBLIC_FILES.has(relative);
}

function assertPrivateConfigPath(resolvedPath) {
  const realRoot = fs.realpathSync(ROOT);
  const realPath = fs.realpathSync(resolvedPath);
  if (isHttpPublicPath(resolvedPath, ROOT) || isHttpPublicPath(realPath, realRoot)) {
    throw new Error('配置文件不能位于 Pavilo 的 HTTP 公开路径（index.html、vendor/、client/、admin/ 或 plays/）');
  }
}

function readLimitedFile(resolvedPath) {
  const descriptor = fs.openSync(resolvedPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(MAX_CONFIG_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_CONFIG_BYTES) throw new Error(`配置文件不能超过 ${MAX_CONFIG_BYTES} 字节`);
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function loadConfig({ env = process.env, configPath } = {}) {
  const explicitlyConfigured = configPath !== undefined || Boolean(env.PAVILO_CONFIG);
  const resolvedPath = path.resolve(configPath || env.PAVILO_CONFIG || path.join(ROOT, 'pavilo.yaml'));
  let source;
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) throw new Error('不是普通文件');
    if (stat.size > MAX_CONFIG_BYTES) throw new Error(`配置文件不能超过 ${MAX_CONFIG_BYTES} 字节`);
    assertPrivateConfigPath(resolvedPath);
    source = readLimitedFile(resolvedPath);
  } catch (error) {
    if (error.code !== 'ENOENT' || explicitlyConfigured) throw new Error(`无法读取配置文件 ${resolvedPath}：${error.message}`);
  }
  const config = source === undefined ? cloneDefaults() : parseConfig(source, resolvedPath);
  if (env.PORT !== undefined && env.PORT !== '') {
    if (typeof env.PORT !== 'string' || !DECIMAL_PORT_RE.test(env.PORT)) fail('PORT', '必须是 1–65535 的严格十进制整数');
    config.port = Number(env.PORT);
  }
  try {
    applySecretEnv(config, env);
  } catch (error) {
    throw new Error(`${source === undefined ? 'config' : resolvedPath}: ${error.message}`);
  }
  return { config, configPath: source === undefined ? null : resolvedPath };
}

function inspectPavilionSources(config) {
  const sources = { room: 'yaml', channels: 'yaml', moderation: 'yaml' };
  const filePath = config.storage?.sqlite?.path;
  if (config.storage?.driver !== 'sqlite' || !filePath || !fs.existsSync(filePath)) return sources;
  const { openSqliteEngine } = require('./src/storage/sqlite-engine');
  const { applyMigrations } = require('./src/storage/migrations');
  const { createOperatorConfigStore } = require('./src/operator/config-store');
  const engine = openSqliteEngine(config.storage.sqlite);
  try {
    applyMigrations(engine);
    const overlay = createOperatorConfigStore(engine).load();
    if (overlay.room) sources.room = 'operator';
    if (overlay.channels) sources.channels = 'operator';
    if (overlay.moderation) sources.moderation = 'operator';
    return sources;
  } finally {
    engine.close();
  }
}

function checkConfig() {
  try {
    const loaded = loadConfig();
    const source = loaded.configPath || '内置默认配置';
    process.stdout.write(`配置有效：${source}\n`);
    const overlaySources = inspectPavilionSources(loaded.config);
    process.stdout.write(`房间真源：${overlaySources.room}\n`);
    process.stdout.write(`聊天频道真源：${overlaySources.channels}\n`);
    process.stdout.write(`门禁真源：${overlaySources.moderation}\n`);
    const notice = sqliteOperatorNotice(loaded.config);
    if (notice) process.stderr.write(`提示：${notice}\n`);
  } catch (error) {
    process.stderr.write(`配置无效：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIG_VERSION,
  SUPPORTED_CONFIG_VERSIONS,
  DEFAULTS,
  MIN_OPERATOR_TOKEN_LENGTH,
  OPERATOR_TOKEN_COMMAND,
  loadConfig,
  normalizeConfig,
  parseConfig,
  operatorConsoleEnabled,
  sqliteOperatorNotice,
  inspectPavilionSources,
  snapshotRoomSection,
  snapshotChannelsSection,
  snapshotModerationSection,
  parseRoomOverlay,
  parseChannelsOverlay,
  parseModerationOverlay,
  applyRoomOverlay,
  applyChannelsOverlay,
  applyModerationOverlay,
  validatePavilionConfig,
  mergePavilionOverlay,
  normalizeIp
};

if (require.main === module) checkConfig();
