'use strict';

const http = require('node:http');
const { DEFAULTS, loadConfig, sqliteOperatorNotice, operatorConsoleEnabled, snapshotRoomSection, snapshotChannelsSection, snapshotModerationSection, mergePavilionOverlay } = require('./config');
const { createChatCore } = require('./src/core');
const { PROTOCOL_VERSION, REACTION_EMOJIS } = require('./src/core/events');
const { createHttpHandler } = require('./src/transport/http');
const { createWebSocketTransport } = require('./src/transport/websocket');
const { createGateway } = require('./src/gateway');
const { openSqliteEngine } = require('./src/storage/sqlite-engine');
const { applyMigrations } = require('./src/storage/migrations');
const { createOperatorHttp, isAdminPath } = require('./src/operator/http');
const { createOperatorConfigStore } = require('./src/operator/config-store');
const { createGovernanceStore } = require('./src/operator/governance-store');
const { createPavilionController } = require('./src/operator/pavilion');

function createChatServer(options = {}) {
  const config = { ...DEFAULTS, ...options };
  config.channels = (options.channels || DEFAULTS.channels).map((channel) => ({ ...channel }));
  config.operator = { ...DEFAULTS.operator, ...(options.operator || {}) };
  config.gateway = { ...structuredClone(DEFAULTS.gateway), ...(options.gateway || {}) };
  config.plays = [...(options.plays || DEFAULTS.plays || [])];
  config.ipDenyList = [...(options.ipDenyList || DEFAULTS.ipDenyList || [])];
  config.userDenyList = [...(options.userDenyList || DEFAULTS.userDenyList || [])];
  config.embedAncestors = [...(options.embedAncestors || DEFAULTS.embedAncestors || [])];
  config.embedDirect = options.embedDirect === true;
  config.operator.enabled = operatorConsoleEnabled(config);
  const sqliteEngine = config.storage?.driver === 'sqlite' && config.storage.sqlite?.path
    ? openSqliteEngine(config.storage.sqlite)
    : undefined;
  const baseline = {
    room: snapshotRoomSection(config),
    channels: snapshotChannelsSection(config),
    moderation: snapshotModerationSection(config)
  };
  let pavilionSources = { room: 'yaml', channels: 'yaml', moderation: 'yaml' };
  let pavilionWarnings = [];
  let operatorConfigStore;
  if (sqliteEngine) {
    applyMigrations(sqliteEngine);
    operatorConfigStore = createOperatorConfigStore(sqliteEngine, { now: options.now });
    const merged = mergePavilionOverlay(config, operatorConfigStore.load());
    pavilionSources = merged.sources;
    pavilionWarnings = merged.warnings;
  }
  let transport;
  const governance = config.operator.enabled && sqliteEngine
    ? createGovernanceStore(sqliteEngine, { now: options.now })
    : null;
  const core = createChatCore(config, { onEffects: (effects) => transport.deliver(effects), engine: sqliteEngine, governance });
  const gateway = createGateway(config, {
    engine: sqliteEngine,
    fetch: options.fetch,
    now: options.now,
    schedule: options.schedule,
    cancel: options.cancel
  });
  const { createPlayRuntime } = require('./src/play');
  const plays = createPlayRuntime(config, {
    root: __dirname,
    engine: sqliteEngine,
    now: options.now,
    schedule: options.schedule,
    cancel: options.cancel,
    randomId: options.randomId,
    complete: (request) => gateway.complete(request),
    onEffects: (effects) => core.deliverPlayEffects(effects),
    postAsAgent: (actorId, text) => core.postAsAgent(actorId, text),
    seatAgent: (input) => core.seatAgent(input),
    roster: (channelId) => core.roster(channelId)
  });
  core.attachPlayRuntime(plays);
  const pavilion = operatorConfigStore
    ? createPavilionController({ config, baseline, store: operatorConfigStore, core })
    : null;
  const publicHttp = createHttpHandler(config, core, () => server.address(), __dirname, {
    healthPatch: () => gateway.healthPatch()
  });
  const operatorHttp = config.operator.enabled
    ? createOperatorHttp(config, { gateway, core, pavilion, root: __dirname })
    : null;
  const server = http.createServer((request, response) => {
    if (operatorHttp && isAdminPath(request)) operatorHttp(request, response);
    else publicHttp(request, response);
  });
  transport = createWebSocketTransport(server, config, core);
  const { listen, stop, localAddresses, state } = transport;
  async function stopAll(signal) {
    const result = await stop(signal);
    gateway.close();
    plays.close();
    sqliteEngine?.close();
    return result;
  }
  const app = {
    server, listen, stop: stopAll, localAddresses, config, state,
    storageInfo: core.storageInfo, gateway, plays, pavilion, pavilionSources, pavilionWarnings
  };
  Object.defineProperty(app, 'roomEpoch', { enumerable: true, get: () => transport.roomEpoch });
  return app;
}

module.exports = { createChatServer, DEFAULTS, PROTOCOL_VERSION, REACTION_EMOJIS: [...REACTION_EMOJIS] };

if (require.main === module) {
  let loaded;
  try {
    loaded = loadConfig();
  } catch (error) {
    process.stderr.write(`无法加载语亭配置：${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const app = createChatServer(loaded.config);
  const pkg = require('./package.json');
  app.listen().then((address) => {
    const port = typeof address === 'object' && address ? address.port : DEFAULTS.port;
    const config = app.config;

    // Banner with version
    process.stdout.write(`\n╭─────────────────────────────────────╮\n`);
    process.stdout.write(`│  Pavilo / 语亭                      │\n`);
    process.stdout.write(`│  v${pkg.version.padEnd(30)} │\n`);
    process.stdout.write(`╰─────────────────────────────────────╯\n\n`);

    // Core info
    process.stdout.write(`✓ Protocol version: ${PROTOCOL_VERSION}\n`);
    const storage = app.storageInfo();
    if (storage.driver === 'sqlite') {
      const retention = storage.retentionDays == null ? 'forever' : `${storage.retentionDays}d`;
      process.stdout.write(`✓ Storage mode: sqlite (engine=${storage.engine}, path=${storage.path}, retentionDays=${retention})\n`);
    } else {
      process.stdout.write(`✓ Storage mode: memory\n`);
    }
    if (config.embedDirect || config.embedAncestors?.length) {
      const framing = config.embedAncestors?.length ? `iframe for ${config.embedAncestors.join(', ')}` : 'top-level only';
      process.stdout.write(`✓ Embed: /embed (${framing})\n`);
    }
    const operatorNotice = sqliteOperatorNotice(config);
    if (operatorNotice) {
      process.stdout.write(`\n⚠️  ${operatorNotice.replaceAll('\n', '\n    ')}\n\n`);
    } else if (config.operator.enabled) {
      process.stdout.write(`✓ Operator console: http://localhost:${port}/admin\n`);
      const snapshot = app.gateway.status();
      process.stdout.write(`✓ Gateway channels: ${snapshot.channels} (configured in /admin)\n`);
    }
    process.stdout.write(`✓ Config source: ${loaded.configPath || 'built-in defaults'}\n`);
    process.stdout.write(`  → Room: ${app.pavilionSources.room}\n`);
    process.stdout.write(`  → Chat channels: ${app.pavilionSources.channels}\n`);
    process.stdout.write(`  → Restart required to apply YAML changes; admin overlay applies immediately\n`);
    for (const warning of app.pavilionWarnings || []) {
      process.stdout.write(`  ⚠️  ${warning}\n`);
    }
    process.stdout.write('\n');

    // Network addresses
    process.stdout.write(`🌐 Listening on:\n`);
    process.stdout.write(`  → Local:  http://localhost:${port}\n`);
    const addresses = app.localAddresses();
    if (addresses.length && config.exposeLanUrls) {
      for (const ip of addresses) {
        process.stdout.write(`  → LAN:    http://${ip}:${port}\n`);
      }
    } else if (!config.exposeLanUrls) {
      process.stdout.write(`  → LAN addresses hidden (exposeLanUrls: false)\n`);
    }

    // Security boundaries
    process.stdout.write(`\n🔒 Security boundaries:\n`);
    process.stdout.write(`  → Origin check: ${config.allowNoOrigin ? 'disabled (allowNoOrigin: true)' : 'enabled'}\n`);
    if (config.allowNoOrigin) {
      process.stdout.write(`    ⚠️  Warning: Non-browser clients allowed. Use allowNoOrigin: false for stricter security.\n`);
    }
    if (config.allowedOrigins.length > 0) {
      process.stdout.write(`  → Allowed origins: ${config.allowedOrigins.join(', ')}\n`);
    }
    process.stdout.write(`  → Member IPs: ${config.exposeMemberIps ? 'visible to all users' : 'hidden'}\n`);
    process.stdout.write(`  → Max users: ${config.maxUsers}\n`);
    process.stdout.write(`  → Max connections: ${config.maxClients}\n\n`);

    process.stdout.write(`Ready to accept connections.\n\n`);
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(`无法启动：端口 ${loaded.config.port} 已被占用。可使用 PORT=4187 npm start 更换端口。\n`);
    } else {
      process.stderr.write(`无法启动语亭聊天室：${error.message}\n`);
    }
    process.exitCode = 1;
  });
  const shutdown = (signal) => app.stop(signal).finally(() => process.exit(0));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
