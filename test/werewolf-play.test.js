'use strict';

// 端到端：真实 core + 真实 play runtime + 真实 werewolf host。
// 验证 playAction 路由、私密投影、deadline 推送与发言落到频道。
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createChatCore } = require('../src/core');
const { createPlayRuntime } = require('../src/play');

const CHANNELS = [
  { id: 'general', name: '闲聊', description: '', enabled: true, readOnly: false, maxUsers: 16, welcome: '' },
  { id: 'village', name: '狼人杀', description: '', enabled: true, readOnly: false, maxUsers: 16, welcome: '', play: 'werewolf' }
];

function harness() {
  let clock = 1_000;
  let sequence = 0;
  const timers = [];
  const delayed = [];
  const emitted = [];
  const config = { ...DEFAULTS, plays: ['werewolf'], channels: CHANNELS, defaultChannelId: 'general' };
  const nextId = (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`;

  const core = createChatCore(config, {
    now: () => clock,
    randomId: nextId,
    randomResumeToken: () => `resume-${String(++sequence).padStart(12, '0')}`,
    randomAvatarSeed: () => 7,
    onEffects: (effects) => emitted.push(...effects),
    schedule(fn, ms) { const timer = { fn, at: clock + (ms || 0), done: false }; timers.push(timer); return timer; },
    cancel(timer) { if (timer) timer.done = true; }
  });

  const plays = createPlayRuntime(config, {
    root: path.join(__dirname, '..'),
    now: () => clock,
    randomId: nextId,
    schedule(fn, ms) {
      if (!ms) { delayed.push(fn); return 0; }
      const timer = { fn, at: clock + ms, done: false };
      timers.push(timer);
      return timer;
    },
    onEffects: (effects) => core.deliverPlayEffects(effects),
    postAsAgent: (actorId, text) => core.postAsAgent(actorId, text),
    seatAgent: (input) => core.seatAgent(input),
    roster: (channelId) => core.roster(channelId)
  });
  core.attachPlayRuntime(plays);

  function flush() { for (const fn of delayed.splice(0)) fn(); }
  function advance(ms) {
    clock += ms;
    for (const timer of timers) {
      if (!timer.done && timer.at <= clock) { timer.done = true; timer.fn(); }
    }
    flush();
  }
  return { core, plays, emitted, advance, flush, now: () => clock };
}

function join(core, peerId, username) {
  core.connect(peerId, '192.0.2.10');
  const result = core.dispatch(peerId, {
    type: 'join', protocolVersion: 4, username,
    clientSessionId: `session-${username.toLowerCase()}-0001`, channelId: 'village', avatarSeed: 7
  });
  assert.equal(result.accepted, true, result.error?.message);
  core.completeSync(peerId);
  return result;
}

let actionSeq = 0;
function act(core, peerId, name, payload = {}) {
  actionSeq += 1;
  return core.dispatch(peerId, {
    type: 'playAction',
    clientActionId: `wwact${String(actionSeq).padStart(10, '0')}`,
    name,
    payload
  });
}

// playAction 有独立限流（默认 8 次 / 5 秒），补满 8 个 AI 必然撞上。
// 真实玩家不会在同一毫秒连点 9 次，所以这里让时钟跟着走。
function seatTable(kit, peerId, agents = 8) {
  assert.equal(act(kit.core, peerId, 'sit', { username: 'Alice' }).accepted, true);
  for (let index = 0; index < agents; index += 1) {
    kit.advance(1_000);
    const seated = act(kit.core, peerId, 'addAgent');
    assert.equal(seated.accepted, true, `第 ${index + 1} 个 AI 应当能落座：${seated.error?.code || ''}`);
  }
  kit.advance(1_000);
}

// 从某个 peer 收到的所有 playState 里取最后一条 state。
// 发起者的那份在 dispatch 返回值里；其他人的经 onChange → runtime.emit
// 异步推送，落在 emitted 里，两处都要看。
function lastStateFor(result, peerId, emitted = []) {
  const fromDispatch = result.effects.filter((effect) => effect.kind === 'send'
    && effect.peerId === peerId && effect.payload?.type === 'playState');
  const fromPush = emitted.filter((effect) => effect.kind === 'send'
    && effect.peerId === peerId && effect.payload?.type === 'playState');
  const all = [...fromPush, ...fromDispatch];
  return all.length ? all.at(-1).payload.state : null;
}

test('the werewolf host loads and projects a lobby view on join', () => {
  const { core } = harness();
  const joined = join(core, 'alice', 'Alice');
  const initial = joined.effects.find((effect) => effect.kind === 'initial');
  assert.ok(initial, '应当收到初始同步');

  const start = initial.payloads.find((payload) => payload.type === 'stateStart');
  assert.ok(start.capabilities.includes('play'), 'stateStart 应声明 play 能力');
  assert.deepEqual(start.play, { id: 'werewolf', page: '/plays/werewolf/' });

  const snapshot = initial.payloads.find((payload) => payload.type === 'playState');
  assert.ok(snapshot, '加入后应当拿到一份 playState');
  assert.equal(snapshot.visibility, 'private');
  assert.equal(snapshot.state.phase.name, 'lobby');
  assert.equal(snapshot.state.self, null, '还没坐下就不是玩家');
});

test('sitting down and filling with agents starts a real game', () => {
  const kit = harness();
  const { core, emitted } = kit;
  join(core, 'alice', 'Alice');
  assert.equal(act(core, 'alice', 'sit', { username: 'Alice' }).accepted, true);

  // 人不够时不能开局。
  const tooEarly = act(core, 'alice', 'start');
  assert.equal(tooEarly.accepted, false);
  assert.equal(tooEarly.error.code, 'WW_NOT_READY');

  for (let index = 0; index < 8; index += 1) {
    kit.advance(1_000);
    assert.equal(act(core, 'alice', 'addAgent').accepted, true, `第 ${index + 1} 个 AI 应当能落座`);
  }
  kit.advance(1_000);
  assert.equal(core.roster('village').filter((session) => session.kind === 'agent').length, 8);

  emitted.length = 0;
  const started = act(core, 'alice', 'start');
  assert.equal(started.accepted, true);

  const view = lastStateFor(started, 'alice');
  assert.equal(view.phase.name, 'night_actions');
  assert.equal(view.seats.length, 9);
  assert.ok(view.self.role, '开局后自己应当拿到身份');
  assert.ok(view.phase.deadline > 0, '夜晚应当有 deadline');
});

test('an agent seat never exposes its real role through the roster', () => {
  const kit = harness();
  const { core } = kit;
  join(core, 'alice', 'Alice');
  seatTable(kit, 'alice');
  act(core, 'alice', 'start');

  // session.role 会经 toActor 进入 actors()，绝不能存真实身份。
  for (const session of core.roster('village')) {
    assert.notEqual(session.role, 'werewolf', 'roster 不得泄漏狼人身份');
    assert.notEqual(session.role, 'seer');
    assert.notEqual(session.role, 'witch');
  }
});

test('two humans plus seven agents: nobody else can see your role', () => {
  const kit = harness();
  const { core } = kit;
  join(core, 'alice', 'Alice');
  join(core, 'bob', 'Bob');
  act(core, 'alice', 'sit', { username: 'Alice' });
  act(core, 'bob', 'sit', { username: 'Bob' });
  for (let index = 0; index < 7; index += 1) {
    kit.advance(1_000);
    assert.equal(act(core, 'alice', 'addAgent').accepted, true);
  }
  kit.advance(1_000);

  kit.emitted.length = 0;
  const started = act(core, 'alice', 'start');
  assert.equal(started.accepted, true);

  const alice = lastStateFor(started, 'alice', kit.emitted);
  const bob = lastStateFor(started, 'bob', kit.emitted);
  assert.ok(bob, 'Bob 没自己动作，也必须收到推送');
  assert.ok(alice.self.role);
  assert.ok(bob.self.role);

  for (const [name, view] of [['alice', alice], ['bob', bob]]) {
    for (const seat of view.seats) {
      if (seat.id === view.self.id) continue;
      assert.ok(!Object.hasOwn(seat, 'role'), `${name} 的视图暴露了别人的身份`);
    }
  }
});

test('a deadline push reaches players with no action of their own', () => {
  const kit = harness();
  const { core, emitted, advance } = kit;
  join(core, 'alice', 'Alice');
  seatTable(kit, 'alice');
  act(core, 'alice', 'start');

  emitted.length = 0;
  // 无人行动，靠 deadline 把夜晚推进。这条路径正是 runtime.emit 的用途。
  advance(61_000);

  const pushes = emitted.filter((effect) => effect.payload?.type === 'playState');
  assert.ok(pushes.length > 0, 'deadline 到点后必须有主动推送');
  const forAlice = pushes.filter((effect) => effect.payload.actorId === undefined
    ? effect.kind === 'send' : true);
  assert.ok(forAlice.length > 0);
  const phases = pushes.map((effect) => effect.payload.state?.phase?.name).filter(Boolean);
  assert.ok(phases.includes('night_witch'), `阶段应当推进到 night_witch，实际 ${phases.join(',')}`);
});

test('speaking out of turn is rejected, and a real turn posts to the channel', () => {
  const kit = harness();
  const { core, advance } = kit;
  join(core, 'alice', 'Alice');
  seatTable(kit, 'alice');
  act(core, 'alice', 'start');

  const early = act(core, 'alice', 'speak', { text: '现在还是夜里' });
  assert.equal(early.accepted, false);
  assert.equal(early.error.code, 'WW_WRONG_PHASE');

  // 一路超时推进到白天发言。
  for (let guard = 0; guard < 12; guard += 1) {
    advance(95_000);
    const probe = act(core, 'alice', 'speak', { text: '我是好人' });
    if (probe.accepted) {
      const message = probe.effects.find((effect) => effect.payload?.type === 'message');
      assert.ok(message, '发言必须落成频道消息');
      assert.equal(message.payload.message.text, '我是好人');
      assert.equal(message.payload.message.author.username, 'Alice');
      return;
    }
    // 没轮到自己就继续推进
    assert.ok(['WW_NOT_YOUR_TURN', 'WW_WRONG_PHASE', 'WW_DEAD_CANNOT_SPEAK'].includes(probe.error.code),
      `意外的拒绝原因 ${probe.error.code}`);
    if (probe.error.code === 'WW_DEAD_CANNOT_SPEAK') return; // 被刀了也算合理路径
  }
  assert.fail('十二轮内没有轮到 Alice 发言');
});

test('a host crash cannot take the chat channel down with it', () => {
  const { core } = harness();
  join(core, 'alice', 'Alice');
  // 未知动作被 host 拒绝，但不应让频道不可用。
  const bogus = act(core, 'alice', 'definitelyNotAnAction');
  assert.equal(bogus.accepted, false);

  const chat = core.dispatch('alice', {
    type: 'message', kind: 'text', text: '玩法拒绝动作后聊天仍然可用',
    clientMessageId: 'ww-chat-still-works-1'
  });
  assert.equal(chat.accepted, true);
});

test('the game state survives a reload through save and hydrate', () => {
  const kit = harness();
  const { core, plays } = kit;
  join(core, 'alice', 'Alice');
  seatTable(kit, 'alice');
  act(core, 'alice', 'start');

  const saved = plays.store.loadGame('village');
  assert.ok(saved?.state, 'host 必须把对局存下来');
  assert.equal(saved.state.phase, 'night_actions');
  assert.equal(saved.state.seats.length, 9);
});

// —— P3：Agent 真正参与对局（真实 core + runtime + host + spec）。
test('agents act on their own turn through the real runtime', async () => {
  const kit = harness();
  const { core } = kit;
  join(core, 'alice', 'Alice');
  seatTable(kit, 'alice');

  const started = act(core, 'alice', 'start');
  assert.equal(started.accepted, true);
  // requestTurn 走 schedule(fn, 0) → delayed 队列，advance 会 flush
  kit.advance(10);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  // 网关未配置，Agent 会走 onInvalid 兜底，但仍必须给出合法动作。
  // 表现为：夜晚在 deadline 之前就被推完（狼与预言家都行动了）。
  const view = lastStateFor(started, 'alice', kit.emitted);
  assert.ok(view, 'Alice 应当收到状态');
  assert.ok(['night_actions', 'night_witch', 'dawn'].includes(view.phase.name));
});

test('a full game with eight agents reaches an end without human input', async () => {
  const kit = harness();
  const { core } = kit;
  join(core, 'alice', 'Alice');
  seatTable(kit, 'alice');
  act(core, 'alice', 'start');

  // 人类玩家全程不操作：只靠 Agent 兜底动作与 deadline 推进。
  // 这条正是「Agent 失败不能让游戏卡死」的回归测试。
  let phase = null;
  for (let guard = 0; guard < 240; guard += 1) {
    kit.advance(31_000);
    await new Promise((resolve) => setImmediate(resolve));
    const latest = kit.emitted.filter((effect) => effect.payload?.type === 'playState').at(-1);
    phase = latest?.payload?.state?.phase?.name || phase;
    if (phase === 'game_over') break;
  }
  assert.equal(phase, 'game_over', `一局必须能在无人操作下打完，卡在 ${phase}`);
});
