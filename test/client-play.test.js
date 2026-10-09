'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPlayClient } = require('../client/play');
const protocol = require('../client/protocol');

function fakeConnection() {
  const sent = [];
  const listeners = new Set();
  return {
    sent,
    send() { return true; },
    sendRaw(payload) { sent.push(payload); return true; },
    writeChannelId() {},
    readChannelId() { return 'village'; },
    readSession() { return { token: 'resume-token-ok', username: 'Alice' }; },
    setSession() {},
    markJoined() {},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(event) { for (const listener of [...listeners]) listener(event); },
    connect() {},
    getSocket() { return { readyState: 1 }; },
    close() {},
    clearSession() {},
    clearChannelId() {}
  };
}

test('switching off a play channel does not bounce back to the play table', async () => {
  const connection = fakeConnection();
  const assigns = [];
  const play = createPlayClient({
    protocol,
    Connection: { createConnection() { return connection; } },
    location: {
      pathname: '/plays/werewolf/',
      search: '?channel=village',
      assign(url) { assigns.push(url); },
      replace(url) { assigns.push(`replace:${url}`); }
    },
    storage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          defaultChannelId: 'general',
          channels: [
            { id: 'village', name: '狼人杀', enabled: true, play: 'werewolf' },
            { id: 'general', name: '闲聊', enabled: true }
          ]
        };
      }
    })
  });

  await play.start({ channelId: 'village' });
  connection.emit({ type: 'payload', payload: {
    type: 'stateStart',
    channelId: 'village',
    latestSeq: 0,
    self: { id: 'u1', username: 'Alice' },
    users: []
  } });
  connection.sent.length = 0;

  assert.equal(play.switchToChannel({ id: 'general', name: '闲聊', enabled: true }), true);
  assert.equal(play.currentChannel().id, 'general');
  assert.deepEqual(connection.sent, [{ type: 'switchChannel', channelId: 'general' }]);

  connection.emit({ type: 'payload', payload: {
    type: 'stateStart',
    channelId: 'general',
    latestSeq: 0,
    self: { id: 'u1', username: 'Alice' },
    users: []
  } });
  assert.ok(!connection.sent.some((item) => item.channelId === 'village'), '不得把人 switch 回狼人杀');
  assert.ok(assigns.includes('/'));
});
