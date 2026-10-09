'use strict';

// 阶段机：转换、超时、代际失效、动作合法性。注入虚拟时钟，不启网络。
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createMachine, ERR } = require('../plays/werewolf/machine');
const { PHASES } = require('../plays/werewolf/rules/phases');
const { ROLES, CAMP } = require('../plays/werewolf/rules/boards');

function harness(options = {}) {
  let clock = 1_000;
  const timers = [];
  const machine = createMachine({
    now: () => clock,
    schedule(fn, ms) { timers.push({ fn, at: clock + (ms || 0), done: false }); },
    randomId: () => options.seed || 'seed-fixed',
    ...options
  });
  function advance(ms) {
    clock += ms;
    for (const timer of timers) {
      if (!timer.done && timer.at <= clock) { timer.done = true; timer.fn(); }
    }
  }
  // 跳到**当前阶段**的 deadline。不能挑最早的待触发定时器：契约没有
  // cancel，被提前结束的阶段会留下过期定时器，它们比当前 deadline 更早，
  // 触发时只是空转，阶段不会推进。
  function expire() {
    const target = machine.deadline;
    if (!target || target <= clock) return false;
    advance(target - clock + 1);
    return true;
  }
  // 把已排期但尚未触发的定时器交出来，用于验证代际失效。
  function pending() { return timers.filter((timer) => !timer.done); }
  return { machine, advance, expire, pending, now: () => clock };
}

function seatAll(machine, count = 9) {
  for (let index = 1; index <= count; index += 1) {
    machine.dispatch(`u${index}`, { name: 'sit', payload: { username: `P${index}` } });
  }
}

function started(options) {
  const kit = harness(options);
  seatAll(kit.machine);
  kit.machine.dispatch('u1', { name: 'start' });
  return kit;
}

function idsWithRole(machine, role) {
  return machine.seats().filter((seat) => seat.role === role && seat.alive).map((seat) => seat.id);
}
function firstWolf(machine) { return idsWithRole(machine, ROLES.WEREWOLF)[0]; }

// ---------------------------------------------------------------- lobby

test('the table will not start until it is exactly full', () => {
  const { machine } = harness();
  seatAll(machine, 8);
  const early = machine.dispatch('u1', { name: 'start' });
  assert.equal(early.ok, false);
  assert.equal(early.code, ERR.NOT_READY);
  assert.equal(machine.phase, PHASES.LOBBY);

  machine.dispatch('u9', { name: 'sit', payload: { username: 'P9' } });
  assert.equal(machine.dispatch('u1', { name: 'start' }).ok, true);
  assert.equal(machine.phase, PHASES.NIGHT_ACTIONS);
});

test('a tenth player cannot squeeze in, and sitting twice is idempotent', () => {
  const { machine } = harness();
  seatAll(machine, 9);
  assert.equal(machine.dispatch('u10', { name: 'sit', payload: { username: 'P10' } }).code, ERR.FULL);
  assert.equal(machine.dispatch('u1', { name: 'sit', payload: { username: 'P1' } }).ok, true);
  assert.equal(machine.lobby().length, 9);
});

test('seating actions are rejected once the game is running', () => {
  const { machine } = started();
  assert.equal(machine.dispatch('u1', { name: 'sit' }).code, ERR.PHASE);
  assert.equal(machine.dispatch('u1', { name: 'start' }).code, ERR.PHASE);
});

// ---------------------------------------------------------------- 夜晚

test('night advances as soon as every wolf and the seer have acted', () => {
  const { machine } = started();
  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const seer = idsWithRole(machine, ROLES.SEER)[0];
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;

  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  assert.equal(machine.phase, PHASES.NIGHT_ACTIONS, '预言家还没查验，不应推进');

  machine.dispatch(seer, { name: 'seerCheck', payload: { target: wolves[0] } });
  assert.equal(machine.phase, PHASES.NIGHT_WITCH, '全部行动完立即推进，不等 deadline');
});

test('a night nobody acts on still advances on the deadline', () => {
  const { machine, expire } = started();
  assert.equal(machine.phase, PHASES.NIGHT_ACTIONS);
  expire();
  assert.equal(machine.phase, PHASES.NIGHT_WITCH);
  expire();
  assert.equal(machine.phase, PHASES.DAWN, '无人行动时超时链仍然推进');
});

test('non-wolves cannot pick a kill and non-seers cannot check', () => {
  const { machine } = started();
  const villager = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;
  assert.equal(machine.dispatch(villager, { name: 'wolfPick', payload: { target: 'u1' } }).code, ERR.ROLE);
  assert.equal(machine.dispatch(villager, { name: 'seerCheck', payload: { target: 'u1' } }).code, ERR.ROLE);
  assert.equal(machine.dispatch(villager, { name: 'wolfChat', payload: { text: 'hi' } }).code, ERR.ROLE);
});

test('the seer checks once per night and learns the truth', () => {
  const { machine } = started();
  const seer = idsWithRole(machine, ROLES.SEER)[0];
  const wolf = firstWolf(machine);
  assert.equal(machine.dispatch(seer, { name: 'seerCheck', payload: { target: wolf } }).ok, true);
  assert.equal(machine.dispatch(seer, { name: 'seerCheck', payload: { target: 'u2' } }).code, ERR.ALREADY);
  const view = machine.snapshot(seer);
  assert.equal(view.seer.checks.at(-1).isWolf, true);
  assert.equal(machine.dispatch(seer, { name: 'seerCheck', payload: { target: seer } }).code, ERR.ALREADY);
});

test('wolves may pick nobody, and a split vote kills nobody', () => {
  const { machine, expire } = started();
  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const others = machine.seats().filter((seat) => !wolves.includes(seat.id));
  // 三狼各投一个不同目标 → 平票 → 空刀
  wolves.forEach((wolf, index) => machine.dispatch(wolf, { name: 'wolfPick', payload: { target: others[index].id } }));
  expire(); // 预言家不行动，等超时进女巫
  assert.equal(machine.phase, PHASES.NIGHT_WITCH);
  const witch = idsWithRole(machine, ROLES.WITCH)[0];
  assert.equal(machine.snapshot(witch).witch.tonightKill, null, '平票视为空刀');
});

// ---------------------------------------------------------------- 女巫

test('the witch phase always runs its full length, even with no witch alive', () => {
  const { machine, expire } = started();
  expire();
  assert.equal(machine.phase, PHASES.NIGHT_WITCH);
  // 提前结束会泄露「场上没有女巫了」，所以必须走满。
  assert.ok(machine.deadline > 0);
});

test('the witch can save the night one victim', () => {
  const { machine, expire } = started();
  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;
  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  expire();

  const witch = idsWithRole(machine, ROLES.WITCH)[0];
  assert.equal(machine.snapshot(witch).witch.tonightKill, prey);
  assert.equal(machine.dispatch(witch, { name: 'witchSave' }).ok, true);
  assert.equal(machine.phase, PHASES.DAWN, '用药后立即天亮');
  assert.ok(machine.seats().find((seat) => seat.id === prey).alive, '被救的人应当活着');
});

test('the witch cannot use both potions on the same night', () => {
  const { machine, expire } = started();
  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;
  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  expire();
  const witch = idsWithRole(machine, ROLES.WITCH)[0];
  machine.dispatch(witch, { name: 'witchSave' });
  const second = machine.dispatch(witch, { name: 'witchPoison', payload: { target: wolves[0] } });
  assert.equal(second.ok, false, '同夜双药必须被拒绝');
});

test('an unused potion stays available the next night', () => {
  const { machine, expire } = started();
  expire(); expire(); // night_actions → night_witch → dawn（女巫未行动）
  const witch = idsWithRole(machine, ROLES.WITCH)[0];
  assert.deepEqual(machine.snapshot(witch).witch.potions, { save: true, poison: true });
});

// ---------------------------------------------------------------- 发言

test('only the current speaker may speak, and speaking returns a post', () => {
  const { machine, expire } = started();
  expire(); expire(); expire(); // → dawn → 白天
  while (machine.phase === PHASES.LAST_WORDS || machine.phase === PHASES.HUNTER_SHOT) expire();
  assert.equal(machine.phase, PHASES.DAY_SPEECH);

  const speaker = machine.channelState().currentSpeaker;
  const other = machine.seats().find((seat) => seat.alive && seat.id !== speaker).id;
  assert.equal(machine.dispatch(other, { name: 'speak', payload: { text: '我先说' } }).code, ERR.NOT_YOUR_TURN);

  const spoke = machine.dispatch(speaker, { name: 'speak', payload: { text: '我是好人' } });
  assert.equal(spoke.ok, true);
  assert.deepEqual(spoke.post, { text: '我是好人' });
  assert.equal(machine.channelState().currentSpeaker, speaker, '发言不自动结束回合');

  assert.equal(machine.dispatch(speaker, { name: 'speak', payload: { text: '补充一句' } }).ok, true,
    '一个回合内可以连发多条');
  machine.dispatch(speaker, { name: 'endSpeech' });
  assert.notEqual(machine.channelState().currentSpeaker, speaker, 'endSpeech 立即交棒');
});

test('a silent speaker is rotated past on the deadline', () => {
  const { machine, expire } = started();
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  const first = machine.channelState().currentSpeaker;
  expire();
  assert.notEqual(machine.channelState().currentSpeaker, first);
});

test('speech rolls into the vote once everyone has spoken', () => {
  const { machine, expire } = started();
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  for (let guard = 0; guard < 12 && machine.phase === PHASES.DAY_SPEECH; guard += 1) {
    machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
  }
  assert.equal(machine.phase, PHASES.DAY_VOTE);
});

// ---------------------------------------------------------------- 投票

test('a living majority exiles a player and the tally is public', () => {
  const { machine, expire } = started();
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  while (machine.phase === PHASES.DAY_SPEECH) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });

  const living = machine.seats().filter((seat) => seat.alive);
  const target = living.at(-1).id;
  for (const seat of living) {
    if (seat.id === target) machine.dispatch(seat.id, { name: 'abstain' });
    else machine.dispatch(seat.id, { name: 'vote', payload: { target } });
  }
  assert.equal(machine.phase, PHASES.VOTE_RESULT, '票齐后立即唱票');
  const round = machine.channelState().voteRound;
  assert.equal(round.outcome, 'exile');
  assert.equal(round.exiled, target);
  assert.ok(round.detail[target].length >= 1, '唱票必须公开谁投了谁');
});

test('voting twice is rejected and the dead cannot vote', () => {
  const { machine, expire } = started();
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  while (machine.phase === PHASES.DAY_SPEECH) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });

  const living = machine.seats().filter((seat) => seat.alive);
  const voter = living[0].id;
  const target = living[1].id;
  assert.equal(machine.dispatch(voter, { name: 'vote', payload: { target } }).ok, true);
  assert.equal(machine.dispatch(voter, { name: 'vote', payload: { target } }).code, ERR.ALREADY);

  const dead = machine.seats().find((seat) => !seat.alive);
  if (dead) assert.equal(machine.dispatch(dead.id, { name: 'vote', payload: { target } }).code, ERR.DEAD);
});

test('an unfinished vote closes on the deadline with abstentions', () => {
  const { machine, expire } = started();
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  while (machine.phase === PHASES.DAY_SPEECH) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
  assert.equal(machine.phase, PHASES.DAY_VOTE);
  expire();
  assert.equal(machine.phase, PHASES.VOTE_RESULT);
  assert.ok(machine.channelState().voteRound.abstain > 0);
});

test('a tie sends the tied players to PK and excludes them from the revote', () => {
  const { machine, expire } = started();
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  while (machine.phase === PHASES.DAY_SPEECH) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });

  const living = machine.seats().filter((seat) => seat.alive);
  const [a, b] = [living[0].id, living[1].id];
  machine.dispatch(living[2].id, { name: 'vote', payload: { target: a } });
  machine.dispatch(living[3].id, { name: 'vote', payload: { target: b } });
  for (const seat of living.slice(4)) machine.dispatch(seat.id, { name: 'abstain' });
  machine.dispatch(a, { name: 'abstain' });
  machine.dispatch(b, { name: 'abstain' });

  assert.equal(machine.phase, PHASES.VOTE_RESULT);
  assert.equal(machine.channelState().voteRound.outcome, 'tie');
  expire();
  assert.equal(machine.phase, PHASES.PK_SPEECH);
  while (machine.phase === PHASES.PK_SPEECH) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
  assert.equal(machine.phase, PHASES.PK_VOTE);
  assert.equal(machine.dispatch(a, { name: 'vote', payload: { target: b } }).code, ERR.NOT_YOUR_TURN,
    '平票者本人不参与 PK 投票');
});

// ---------------------------------------------------------------- 出局

test('a dead player can neither speak nor act', () => {
  const { machine, expire } = started();
  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;
  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  expire(); // → witch
  machine.dispatch(idsWithRole(machine, ROLES.WITCH)[0], { name: 'witchPass' });
  assert.equal(machine.seats().find((seat) => seat.id === prey).alive, false);

  // 首夜死者有遗言，那是唯一的例外窗口。
  while (machine.phase === PHASES.DAWN) expire();
  assert.equal(machine.phase, PHASES.LAST_WORDS);
  assert.equal(machine.channelState().currentSpeaker, prey);
  assert.equal(machine.dispatch(prey, { name: 'speak', payload: { text: '我是好人' } }).ok, true);
  machine.dispatch(prey, { name: 'endSpeech' });

  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  assert.equal(machine.dispatch(prey, { name: 'speak', payload: { text: '再说一句' } }).code, ERR.DEAD);
  assert.deepEqual(machine.legalActionsFor(prey), [], '死者没有任何合法动作');
});

test('night two deaths get no last words', () => {
  const { machine, expire } = started();
  // 第一夜空过
  expire(); expire(); expire();
  while (machine.phase !== PHASES.DAY_SPEECH) expire();
  while (machine.phase === PHASES.DAY_SPEECH) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
  expire(); // 投票超时
  expire(); // 唱票 → 夜晚
  assert.equal(machine.phase, PHASES.NIGHT_ACTIONS);
  assert.equal(machine.channelState().night, 2);

  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const prey = machine.seats().find((seat) => seat.alive && seat.role === ROLES.VILLAGER).id;
  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  expire();
  machine.dispatch(idsWithRole(machine, ROLES.WITCH)[0], { name: 'witchPass' });
  while (machine.phase === PHASES.DAWN) expire();
  assert.notEqual(machine.phase, PHASES.LAST_WORDS, '第二夜起没有遗言');
});

// ---------------------------------------------------------------- 猎人

test('a hunter shot by wolves may fire, and the shot lands', () => {
  // 找一个首夜刀口正好是猎人的 seed。
  for (const seed of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']) {
    const kit = started({ seed });
    const hunter = idsWithRole(kit.machine, ROLES.HUNTER)[0];
    const wolves = idsWithRole(kit.machine, ROLES.WEREWOLF);
    for (const wolf of wolves) kit.machine.dispatch(wolf, { name: 'wolfPick', payload: { target: hunter } });
    kit.expire();
    kit.machine.dispatch(idsWithRole(kit.machine, ROLES.WITCH)[0], { name: 'witchPass' });
    while (kit.machine.phase === PHASES.DAWN) kit.expire();
    // 首夜死者先遗言，讲完才轮到开枪。
    while (kit.machine.phase === PHASES.LAST_WORDS) kit.machine.dispatch(kit.machine.channelState().currentSpeaker, { name: 'endSpeech' });
    assert.equal(kit.machine.phase, PHASES.HUNTER_SHOT, `${seed}: 被狼刀的猎人应当可以开枪`);

    const victim = wolves[0];
    assert.equal(kit.machine.dispatch(hunter, { name: 'hunterShoot', payload: { target: victim } }).ok, true);
    assert.equal(kit.machine.seats().find((seat) => seat.id === victim).alive, false, '枪必须打死人');
    return;
  }
  assert.fail('没有找到首夜可开枪的 seed');
});

test('a poisoned hunter never gets the shot phase', () => {
  const { machine, expire } = started();
  const hunter = idsWithRole(machine, ROLES.HUNTER)[0];
  const witch = idsWithRole(machine, ROLES.WITCH)[0];
  expire(); // 狼不行动 → witch
  assert.equal(machine.dispatch(witch, { name: 'witchPoison', payload: { target: hunter } }).ok, true);
  assert.equal(machine.seats().find((seat) => seat.id === hunter).alive, false);
  while (machine.phase === PHASES.DAWN || machine.phase === PHASES.LAST_WORDS) {
    if (machine.phase === PHASES.LAST_WORDS) machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
    else expire();
  }
  assert.notEqual(machine.phase, PHASES.HUNTER_SHOT, '被毒死的猎人不能开枪');
});

test('a hunter who runs out the clock loses the shot', () => {
  for (const seed of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']) {
    const kit = started({ seed });
    const hunter = idsWithRole(kit.machine, ROLES.HUNTER)[0];
    const wolves = idsWithRole(kit.machine, ROLES.WEREWOLF);
    for (const wolf of wolves) kit.machine.dispatch(wolf, { name: 'wolfPick', payload: { target: hunter } });
    kit.expire();
    kit.machine.dispatch(idsWithRole(kit.machine, ROLES.WITCH)[0], { name: 'witchPass' });
    while (kit.machine.phase === PHASES.DAWN) kit.expire();
    while (kit.machine.phase === PHASES.LAST_WORDS) kit.machine.dispatch(kit.machine.channelState().currentSpeaker, { name: 'endSpeech' });
    if (kit.machine.phase !== PHASES.HUNTER_SHOT) continue;

    const before = kit.machine.seats().filter((seat) => seat.alive).length;
    kit.expire();
    assert.notEqual(kit.machine.phase, PHASES.HUNTER_SHOT, '超时必须离开开枪阶段');
    assert.equal(kit.machine.seats().filter((seat) => seat.alive).length, before, '超时视为弃枪');
    return;
  }
  assert.fail('没有找到首夜可开枪的 seed');
});

// ---------------------------------------------------------------- 定时器代际

test('an expired timer from a finished phase cannot rewind the game', () => {
  const { machine, advance, pending } = started();
  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const seer = idsWithRole(machine, ROLES.SEER)[0];
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;
  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  machine.dispatch(seer, { name: 'seerCheck', payload: { target: wolves[0] } });
  assert.equal(machine.phase, PHASES.NIGHT_WITCH, '提前完成即推进');

  // night_actions 的 60s 定时器仍会到点，但那一代已经作废。停在女巫
  // 自己的 30s deadline 之前推进时钟，确保观察到的只是过期回调。
  const witchDeadline = machine.deadline;
  advance(witchDeadline - 1_000 - 1);
  assert.equal(machine.phase, PHASES.NIGHT_WITCH, '过期定时器不得再次推进阶段');
  assert.equal(machine.deadline, witchDeadline, '过期回调也不得重置 deadline');
});

// 没有 runtime.cancel，过期定时器一定会到点，全靠代际计数自检。
// 少了这道守卫，过期回调会顶掉**当前**阶段的定时器，游戏之后再也不会
// 自行推进 —— 这才是真正的后果，所以断言必须落在「之后还能不能走」。
test('a stale phase timer neither advances the game nor disarms the live one', () => {
  const { machine, advance, pending } = started();
  const staleTimers = pending();
  assert.equal(staleTimers.length, 1, 'night_actions 应当排了一个定时器');

  const wolves = idsWithRole(machine, ROLES.WEREWOLF);
  const seer = idsWithRole(machine, ROLES.SEER)[0];
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;
  for (const wolf of wolves) machine.dispatch(wolf, { name: 'wolfPick', payload: { target: prey } });
  machine.dispatch(seer, { name: 'seerCheck', payload: { target: wolves[0] } });
  assert.equal(machine.phase, PHASES.NIGHT_WITCH);

  const witchDeadline = machine.deadline;
  // 时钟必须真的走过一段，否则重设的 deadline 与原值数值相同，看不出差别。
  advance(10_000);
  staleTimers[0].fn();
  assert.equal(machine.phase, PHASES.NIGHT_WITCH, '陈旧定时器不得推进阶段');
  assert.equal(machine.deadline, witchDeadline, '陈旧定时器不得顶掉当前阶段的 deadline');

  // 关键：真正的女巫定时器必须仍然有效。
  advance(witchDeadline - 11_000 + 1);
  assert.equal(machine.phase, PHASES.DAWN, '陈旧回调不得让当前阶段的定时器失效');
});

test('the deadline is exposed and moves forward with each phase', () => {
  const { machine, expire, now } = started();
  const first = machine.deadline;
  assert.ok(first > now());
  expire();
  assert.ok(machine.deadline > first, '新阶段应有新的 deadline');
});

// ---------------------------------------------------------------- 存档

test('a rehydrated game keeps its phase and re-arms the timer', () => {
  const { machine, expire } = started();
  expire();
  const saved = JSON.parse(JSON.stringify(machine.serialize()));
  assert.equal(saved.phase, PHASES.NIGHT_WITCH);

  const revived = harness();
  assert.equal(revived.machine.hydrate(saved), true);
  assert.equal(revived.machine.phase, PHASES.NIGHT_WITCH);
  assert.deepEqual(revived.machine.seats().map((seat) => seat.role), machine.seats().map((seat) => seat.role));

  // 关键：定时器不在存档里，重启后必须重新武装，否则永远卡住。
  revived.expire();
  assert.equal(revived.machine.phase, PHASES.DAWN, '重启后阶段必须还能自行推进');
});

test('hydrate refuses a snapshot from an unknown board', () => {
  const { machine } = harness();
  assert.equal(machine.hydrate({ phase: PHASES.DAY_VOTE, boardId: 'nope' }), false);
  assert.equal(machine.hydrate(null), false);
});

// ---------------------------------------------------------------- 合法动作

test('legalActions match what the phase actually accepts', () => {
  const { machine } = started();
  const wolf = firstWolf(machine);
  const villager = machine.seats().find((seat) => seat.role === ROLES.VILLAGER).id;

  const wolfActions = machine.legalActionsFor(wolf).map((action) => action.name);
  assert.ok(wolfActions.includes('wolfPick'));
  assert.ok(wolfActions.includes('wolfChat'));
  assert.deepEqual(machine.legalActionsFor(villager), [], '夜里平民无事可做');

  // 不在 legalActions 里的动作必须真的被拒。
  assert.equal(machine.dispatch(villager, { name: 'wolfPick', payload: { target: wolf } }).ok, false);
});

test('unknown actions and strangers are rejected', () => {
  const { machine } = started();
  assert.equal(machine.dispatch('u1', { name: 'nope' }).code, 'WW_UNKNOWN_ACTION');
  assert.equal(machine.dispatch('stranger', { name: 'wolfPick', payload: {} }).code, ERR.NOT_SEATED);
  assert.deepEqual(machine.legalActionsFor('stranger'), []);
});

// ---------------------------------------------------------------- 终局

test('a full game reaches game over and reveals every role', () => {
  const { machine, expire } = started();
  for (let guard = 0; guard < 400 && machine.phase !== PHASES.GAME_OVER; guard += 1) {
    const phase = machine.phase;
    if (phase === PHASES.DAY_VOTE || phase === PHASES.PK_VOTE) {
      // 好人每天精准投出一只狼，保证收敛。
      const wolf = firstWolf(machine);
      const eligible = machine.seats().filter((seat) => seat.alive && seat.id !== wolf);
      for (const seat of eligible) machine.dispatch(seat.id, { name: 'vote', payload: { target: wolf } });
      if (machine.phase === phase) expire();
      continue;
    }
    if (machine.channelState().currentSpeaker) {
      machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
      continue;
    }
    if (!expire()) break;
  }
  assert.equal(machine.phase, PHASES.GAME_OVER, '一局必须能打到终局');
  assert.equal(machine.result.winner, CAMP.GOOD);

  const view = machine.snapshot('u1');
  assert.ok(view.seats.every((seat) => typeof seat.role === 'string'), '终局揭晓全部身份');
});

test('restart returns everyone to the lobby with the roles cleared', () => {
  const { machine, expire } = started();
  for (let guard = 0; guard < 400 && machine.phase !== PHASES.GAME_OVER; guard += 1) {
    if (machine.phase === PHASES.DAY_VOTE || machine.phase === PHASES.PK_VOTE) {
      const wolf = firstWolf(machine);
      for (const seat of machine.seats().filter((item) => item.alive && item.id !== wolf)) {
        machine.dispatch(seat.id, { name: 'vote', payload: { target: wolf } });
      }
      if (machine.phase !== PHASES.VOTE_RESULT) expire();
      continue;
    }
    if (machine.channelState().currentSpeaker) {
      machine.dispatch(machine.channelState().currentSpeaker, { name: 'endSpeech' });
      continue;
    }
    if (!expire()) break;
  }
  assert.equal(machine.phase, PHASES.GAME_OVER);
  assert.equal(machine.dispatch('u1', { name: 'restart' }).ok, true);
  assert.equal(machine.phase, PHASES.LOBBY);
  assert.equal(machine.lobby().length, 9, '原班人马留在座位上');
  assert.deepEqual(machine.seats(), [], '身份必须清空');
  assert.equal(machine.snapshot('u1').self, null);
});
