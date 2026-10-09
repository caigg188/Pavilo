'use strict';

// Agent spec：合法动作约束、兜底行为，以及最关键的 —— 提示词不得泄底。
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { specFor, SPECS } = require('../plays/werewolf/agents');
const { fallbackAction } = require('../plays/werewolf/agents/base');
const { createMachine } = require('../plays/werewolf/machine');
const { ROLES } = require('../plays/werewolf/rules/boards');

function startedGame(seed = 'agent-seed') {
  const timers = [];
  let clock = 1_000;
  const machine = createMachine({
    now: () => clock,
    schedule: (fn, ms) => timers.push({ fn, at: clock + (ms || 0), done: false }),
    randomId: () => seed
  });
  for (let index = 1; index <= 9; index += 1) {
    machine.dispatch(`u${index}`, { name: 'sit', payload: { username: `P${index}`, kind: 'agent' } });
  }
  machine.dispatch('u1', { name: 'start' });
  return { machine, advance(ms) {
    clock += ms;
    for (const timer of timers) if (!timer.done && timer.at <= clock) { timer.done = true; timer.fn(); }
  } };
}

function seatWithRole(machine, role) {
  return machine.seats().find((seat) => seat.role === role);
}

// 走一遍真实的 agent 循环，把送给模型的 prompt 抓出来。
async function capturePrompt(spec, machine, actorId) {
  let captured = null;
  await spec.runTurn({
    actor: { id: actorId, username: 'bot', kind: 'agent' },
    legalActions: machine.legalActionsFor(actorId),
    privateView: machine.snapshot(actorId),
    turn: 1,
    complete: async (request) => {
      captured = request;
      return { ok: false, code: 'GATEWAY_DISABLED' };
    },
    memory: { read: () => [], append() {} }
  });
  return captured;
}

test('every role has a spec and villager is the fallback', () => {
  for (const role of ['werewolf', 'seer', 'witch', 'hunter', 'villager']) {
    assert.equal(typeof specFor(role).runTurn, 'function', `${role} 缺少 spec`);
  }
  assert.equal(specFor('nonsense'), SPECS.villager);
});

// ★ 非上帝视角：Agent 的上下文就是 host.snapshot(actor)，
// 物理上拿不到别人的身份。这条不变量必须直接验证提示词文本。
test('no agent prompt ever contains another player role', async () => {
  const { machine } = startedGame();
  const seats = machine.seats();

  for (const seat of seats) {
    const spec = specFor(seat.role);
    const request = await capturePrompt(spec, machine, seat.id);
    assert.ok(request, `${seat.role} 没有发出请求`);
    const text = JSON.stringify(request.messages);

    for (const other of seats) {
      if (other.id === seat.id) continue;
      // 狼人知道队友是狼，这是规则允许的；其余任何身份都不得出现。
      const teammate = seat.role === ROLES.WEREWOLF && other.role === ROLES.WEREWOLF;
      if (teammate) continue;
      const pattern = new RegExp(`${other.seat}\\s*号[^。；\\n]{0,6}(预言家|女巫|猎人|狼人)`);
      assert.ok(!pattern.test(text), `${seat.role} 的提示词泄漏了 ${other.seat} 号的身份`);
    }
  }
});

test('a wolf prompt names its teammates but never the seer or witch', async () => {
  const { machine } = startedGame();
  const wolf = seatWithRole(machine, ROLES.WEREWOLF);
  const request = await capturePrompt(specFor(ROLES.WEREWOLF), machine, wolf.id);
  const text = JSON.stringify(request.messages);

  const mates = machine.seats().filter((seat) => seat.role === ROLES.WEREWOLF && seat.id !== wolf.id);
  for (const mate of mates) {
    assert.ok(text.includes(`${mate.seat} 号`) || text.includes(`"seat":${mate.seat}`),
      `狼人应当知道队友 ${mate.seat} 号`);
  }
  const seer = seatWithRole(machine, ROLES.SEER);
  assert.ok(!new RegExp(`${seer.seat}\\s*号是?预言家`).test(text), '狼人不得看到预言家是谁');
});

test('the seer prompt carries its own checks and nobody else sees them', async () => {
  const { machine, advance } = startedGame();
  const seer = seatWithRole(machine, ROLES.SEER);
  const wolf = seatWithRole(machine, ROLES.WEREWOLF);
  machine.dispatch(seer.id, { name: 'seerCheck', payload: { target: wolf.id } });

  const mine = await capturePrompt(specFor(ROLES.SEER), machine, seer.id);
  assert.ok(JSON.stringify(mine.messages).includes('查'), '预言家的提示词应当带查验信息');

  const villager = seatWithRole(machine, ROLES.VILLAGER);
  const theirs = await capturePrompt(specFor(ROLES.VILLAGER), machine, villager.id);
  assert.ok(!JSON.stringify(theirs.messages).includes('isWolf'), '平民不得看到查验结果');
  void advance;
});

test("the witch prompt shows tonight's victim, other roles never see it", async () => {
  const { machine, advance } = startedGame();
  const wolves = machine.seats().filter((seat) => seat.role === ROLES.WEREWOLF);
  const prey = machine.seats().find((seat) => seat.role === ROLES.VILLAGER);
  for (const wolf of wolves) machine.dispatch(wolf.id, { name: 'wolfPick', payload: { target: prey.id } });
  advance(61_000);

  const witch = seatWithRole(machine, ROLES.WITCH);
  const mine = await capturePrompt(specFor(ROLES.WITCH), machine, witch.id);
  assert.ok(JSON.stringify(mine.messages).includes('被狼人袭击'), '女巫应当知道今晚的刀口');

  const hunter = seatWithRole(machine, ROLES.HUNTER);
  const theirs = await capturePrompt(specFor(ROLES.HUNTER), machine, hunter.id);
  assert.ok(!JSON.stringify(theirs.messages).includes('tonightKill'), '猎人不得看到刀口');
});

// ★ 兜底绝不能只返回 skip：三只狼全是 Agent 且网关挂掉时，
// 每晚空刀会让游戏永远打不完。
test('a dead gateway still produces a legal action, not an endless stall', async () => {
  const { machine } = startedGame();
  const wolf = seatWithRole(machine, ROLES.WEREWOLF);
  const legalActions = machine.legalActionsFor(wolf.id);
  assert.ok(legalActions.length > 0);

  const action = await specFor(ROLES.WEREWOLF).runTurn({
    actor: { id: wolf.id, username: 'bot', kind: 'agent' },
    legalActions,
    privateView: machine.snapshot(wolf.id),
    turn: 1,
    complete: async () => ({ ok: false, code: 'GATEWAY_DISABLED' }),
    memory: { read: () => [], append() {} }
  });

  assert.notEqual(action.name, 'skip', '网关不可用时不能空转');
  const accepted = machine.dispatch(wolf.id, action);
  assert.equal(accepted.ok, true, `兜底动作必须是合法动作：${accepted.code || ''}`);
});

test('fallback prefers a harmless option over a random target', () => {
  assert.equal(fallbackAction({ legalActions: [{ name: 'witchPass' }, { name: 'witchPoison', payload: { target: 'x' } }] }).name, 'witchPass');
  assert.equal(fallbackAction({ legalActions: [{ name: 'hunterShoot', payload: { target: 'x' } }, { name: 'hunterPass' }] }).name, 'hunterPass');
  assert.equal(fallbackAction({ legalActions: [{ name: 'vote', payload: { target: 'x' } }, { name: 'abstain' }] }).name, 'abstain');
  assert.equal(fallbackAction({ legalActions: [] }).name, 'skip');

  // 狼人必须给出刀口，没有安全项时随机挑一个合法目标。
  const forced = fallbackAction({ legalActions: [{ name: 'wolfPick', payload: { target: 'a' } }, { name: 'wolfPick', payload: { target: 'b' } }] });
  assert.equal(forced.name, 'wolfPick');
  assert.ok(['a', 'b'].includes(forced.payload.target));
});

test('speaking falls back to a neutral line rather than silence', () => {
  const action = fallbackAction({ legalActions: [{ name: 'speak' }, { name: 'endSpeech' }] });
  assert.equal(action.name, 'speak');
  assert.ok(action.payload.text.length > 0, '发言回合不能交白卷');
});

test('a model that invents an illegal action is overruled', async () => {
  const { machine } = startedGame();
  const wolf = seatWithRole(machine, ROLES.WEREWOLF);
  const action = await specFor(ROLES.WEREWOLF).runTurn({
    actor: { id: wolf.id, username: 'bot', kind: 'agent' },
    legalActions: machine.legalActionsFor(wolf.id),
    privateView: machine.snapshot(wolf.id),
    turn: 1,
    // 模型编造一个不存在的动作
    complete: async () => ({ ok: true, text: '{"name":"winTheGame","payload":{}}' }),
    memory: { read: () => [], append() {} }
  });
  assert.notEqual(action.name, 'winTheGame');
  assert.equal(machine.dispatch(wolf.id, action).ok, true, '被否决后仍要给出合法动作');
});

test('a well-behaved model has its choice honoured', async () => {
  const { machine } = startedGame();
  const wolf = seatWithRole(machine, ROLES.WEREWOLF);
  const legalActions = machine.legalActionsFor(wolf.id);
  const pick = legalActions.find((entry) => entry.name === 'wolfPick' && entry.payload?.target);

  const action = await specFor(ROLES.WEREWOLF).runTurn({
    actor: { id: wolf.id, username: 'bot', kind: 'agent' },
    legalActions,
    privateView: machine.snapshot(wolf.id),
    turn: 1,
    complete: async () => ({ ok: true, text: JSON.stringify(pick) }),
    memory: { read: () => [], append() {} }
  });
  assert.deepEqual(action, { name: 'wolfPick', payload: pick.payload });
});

test('every role prompt states the board and that role', async () => {
  const { machine } = startedGame();
  for (const seat of machine.seats()) {
    const request = await capturePrompt(specFor(seat.role), machine, seat.id);
    const system = request.messages.find((message) => message.role === 'system').content;
    assert.ok(system.includes('9 人标准局'), `${seat.role} 的提示词缺少板子说明`);
    assert.ok(system.includes(`你是 ${seat.seat} 号`), `${seat.role} 的提示词缺少座位号`);
    assert.ok(system.includes('JSON'), `${seat.role} 的提示词缺少输出格式约束`);
  }
});
