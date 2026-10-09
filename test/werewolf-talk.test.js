'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { briefing, parsePlan, actionFromPlan, lastSpeech } = require('../plays/werewolf/agents/talk');
const { specFor } = require('../plays/werewolf/agents');
const { createMachine } = require('../plays/werewolf/machine');
const { ROLES } = require('../plays/werewolf/rules/boards');

test('briefing tells the agent to react to the last spoken line', () => {
  const view = {
    self: { id: 'u4', seat: 4, role: 'villager', alive: true },
    seats: [
      { id: 'u1', seat: 1, username: 'tao', alive: true },
      { id: 'u4', seat: 4, username: 'AI-4', alive: true }
    ],
    log: [
      { kind: 'dayBegan', day: 1 },
      { kind: 'speech', seat: 1, text: '我是预言家，昨天查到2号是狼人' }
    ]
  };
  const last = lastSpeech(view);
  assert.equal(last.seat, 1);
  const text = briefing(view, '你是平民。', '预测表空');
  assert.ok(text.includes('我是预言家，昨天查到2号是狼人'));
  assert.ok(text.includes('必须接这一句'));
  assert.ok(!text.includes('werewolf'));
});

test('a think-plan with say becomes a speak action', () => {
  const plan = parsePlan(JSON.stringify({
    thought: '1号跳预言家报2号查杀，我先当真跳压一压',
    reactTo: '1号报2号狼',
    reads: [{ seat: 2, guess: 'wolf', conf: 4, why: '被报查杀' }],
    say: '1号你跳预了，查杀2号我先记下。2号你怎么说？'
  }));
  const action = actionFromPlan(plan, {
    legalActions: [{ name: 'speak' }, { name: 'endSpeech' }],
    privateView: { seats: [{ id: 'u1', seat: 1 }, { id: 'u2', seat: 2 }] }
  });
  assert.equal(action.name, 'speak');
  assert.ok(action.payload.text.includes('1号你跳预了'));
});

test('a think-plan with targetSeat becomes the matching vote', () => {
  const plan = parsePlan('{"thought":"跟自己的狼坑","reactTo":"1号查杀","targetSeat":2,"say":""}');
  const action = actionFromPlan(plan, {
    legalActions: [
      { name: 'vote', payload: { target: 'u2' } },
      { name: 'vote', payload: { target: 'u3' } },
      { name: 'abstain' }
    ],
    privateView: { seats: [{ id: 'u2', seat: 2 }, { id: 'u3', seat: 3 }] }
  });
  assert.equal(action.name, 'vote');
  assert.equal(action.payload.target, 'u2');
});

test('a live agent uses the think plan before falling back to canned speech', async () => {
  const timers = [];
  let clock = 1_000;
  const machine = createMachine({
    now: () => clock,
    schedule: (fn, ms) => timers.push({ fn, at: clock + (ms || 0), done: false }),
    randomId: () => 'talk-seed'
  });
  for (let index = 1; index <= 9; index += 1) {
    machine.dispatch(`u${index}`, { name: 'sit', payload: { username: `P${index}`, kind: 'agent' } });
  }
  machine.dispatch('u1', { name: 'start' });
  const villager = machine.seats().find((seat) => seat.role === ROLES.VILLAGER);
  const action = await specFor(ROLES.VILLAGER).runTurn({
    actor: { id: villager.id, username: 'bot', kind: 'agent' },
    legalActions: [{ name: 'speak' }],
    privateView: {
      ...machine.snapshot(villager.id),
      log: [
        { kind: 'dayBegan', day: 1 },
        { kind: 'speech', seat: 1, text: '我是预言家，昨天查到2号是狼人' }
      ]
    },
    turn: 1,
    complete: async () => ({
      ok: true,
      text: JSON.stringify({
        thought: '接1号的跳',
        reactTo: '1号报查杀2号',
        reads: [{ seat: 2, guess: 'wolf', conf: 4, why: '被预查杀' }],
        say: '1号你报2号查杀，我先当你是真预。2号你给个反驳。'
      })
    }),
    memory: { read: () => [], append() {} }
  });
  assert.equal(action.name, 'speak');
  assert.ok(action.payload.text.includes('1号你报2号查杀'));
  assert.ok(!/发言空|最像在混/.test(action.payload.text));
});

// 跨轮记忆：Agent 必须拿到自己视角下的完整记录 —— 自己和别人的发言
// 全都要有，不能只给最近几句，否则它只能拿残缺上下文硬凑逻辑。
test('briefing carries the whole timeline, not just the current round', () => {
  const view = {
    self: { id: 'u4', seat: 4, role: 'villager', alive: true },
    seats: [
      { id: 'u1', seat: 1, username: 'tao', alive: true },
      { id: 'u4', seat: 4, username: 'AI-4', alive: true }
    ],
    log: [
      { kind: 'dayBegan', day: 1 },
      { kind: 'speech', seat: 1, text: '第一天的第一句' },
      { kind: 'speech', seat: 4, text: '第一天我说过要盯3号的票' },
      { kind: 'dayBegan', day: 2 },
      { kind: 'speech', seat: 1, text: '第二天的第一句' },
      { kind: 'speech', seat: 4, text: '我今天还是那句' }
    ]
  };
  const text = briefing(view, '你是平民。', '预测表空');
  assert.ok(text.includes('第一天的第一句'), '别人上一轮说的话也要看得到');
  assert.ok(text.includes('第一天我说过要盯3号的票'), '自己上一轮的发言也要看得到');
  assert.ok(text.includes('第二天的第一句'), '本轮的发言当然要在');
  assert.ok(text.includes('4号（你）'), '自己的发言要标出来，方便对照立场');
  assert.ok(!text.includes('1号（你）'), '不能把别人的发言标成自己的');
});

test('the timeline renders votes, deaths and shots in order', () => {
  const view = {
    self: { id: 'u4', seat: 4, role: 'villager', alive: true },
    seats: [
      { id: 'u1', seat: 1, username: 'tao', alive: true },
      { id: 'u3', seat: 3, username: 'AI-3', alive: false },
      { id: 'u4', seat: 4, username: 'AI-4', alive: true }
    ],
    log: [
      { kind: 'nightFell', night: 1 },
      { kind: 'dawn', night: 1, deaths: [3] },
      { kind: 'dayBegan', day: 1 },
      { kind: 'voteResult', outcome: 'exile', exiled: 'u3', exiledSeat: 3,
        detail: [{ targetSeat: 3, voterSeats: [1, 4] }], abstainSeats: [] }
    ]
  };
  const text = briefing(view, '你是平民。', '');
  assert.ok(/第 1 夜结果】3 号出局/.test(text), '死讯要进记录');
  assert.ok(/1、4号→3号/.test(text), '票型要进记录');
  assert.ok(/3 号被放逐/.test(text), '放逐结果要进记录');
});

test('an over-long timeline says so instead of silently dropping the start', () => {
  const long = '这是一段很长的发言。'.repeat(200);
  const log = [{ kind: 'dayBegan', day: 1 }];
  for (let index = 0; index < 60; index += 1) log.push({ kind: 'speech', seat: 1, text: long });
  const view = {
    self: { id: 'u4', seat: 4, role: 'villager', alive: true },
    seats: [{ id: 'u1', seat: 1, username: 'tao', alive: true }],
    log
  };
  const text = briefing(view, '你是平民。', '');
  assert.ok(text.includes('前面的内容没有给你'), '超预算必须明说，不能假装记录是完整的');
});
