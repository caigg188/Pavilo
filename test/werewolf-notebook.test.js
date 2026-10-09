'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { digest, notebookFromModel, reviseMemory, formatNotebook } = require('../plays/werewolf/agents/notebook');
const { briefing } = require('../plays/werewolf/agents/talk');
const { specFor } = require('../plays/werewolf/agents');
const { tableFor } = require('../plays/werewolf/agents/reads');

const view = {
  self: { id: 'u4', seat: 4, role: 'werewolf', alive: true },
  seats: [
    { id: 'u1', seat: 1, alive: true },
    { id: 'u2', seat: 2, alive: true },
    { id: 'u4', seat: 4, alive: true }
  ],
  wolf: { team: [{ id: 'u2', seat: 2, isSelf: false, alive: true }, { id: 'u4', seat: 4, isSelf: true, alive: true }] },
  log: [
    { kind: 'dawn', night: 1, deaths: [] },
    { kind: 'dayBegan', day: 1 },
    { kind: 'speech', seat: 1, text: '我是预言家，查杀3号' }
  ]
};

test('digest keeps deaths and speeches and ignores phase noise', () => {
  const lines = digest(view);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /平安/);
  assert.match(lines[1], /1号发言/);
});

test('an action JSON is not mistaken for a notebook', () => {
  assert.equal(notebookFromModel('{"name":"speak","payload":{"text":"过"}}'), null);
  const book = notebookFromModel(JSON.stringify({
    facts: ['1号跳预言家'],
    reads: [{ seat: 1, guess: 'seer', conf: 3, why: '跳了' }],
    note: '先听3号反驳'
  }));
  assert.equal(book.note, '先听3号反驳');
  assert.equal(book.facts.length, 1);
});

test('a revision is stored, locks teammates, and is not repeated once caught up', async () => {
  const memory = [];
  let calls = 0;
  const ctx = {
    privateView: view,
    complete: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify({
          facts: ['1号跳预，报查杀3号'],
          reads: [{ seat: 2, guess: 'good', conf: 5, why: '想洗白队友' }],
          note: '白天把1号当跳预来盘，别提2号'
        })
      };
    },
    memory: {
      read: () => memory,
      append(body) { memory.push({ body }); }
    }
  };
  assert.equal(await reviseMemory(ctx), true);
  assert.equal(calls, 1);
  assert.equal(memory[0].body.kind, 'notebook');
  assert.equal(memory[0].body.seen, 2);
  const locked = tableFor(view, memory);
  assert.equal(locked.find((row) => row.seat === 2).guess, 'wolf');
  assert.match(formatNotebook(memory[0].body), /别提2号/);

  assert.equal(await reviseMemory(ctx), true);
  assert.equal(calls, 1, '没有新事实就不要再叫模型');
});

test('the speech prompt carries the notebook and the cost of staying silent', async () => {
  const text = briefing(view, '你是狼人。', '预测表', '笔记：1号像在跳预');
  assert.match(text, /笔记：1号像在跳预/);
  assert.match(text, /1号发言|我是预言家/);

  const memory = [{
    body: {
      kind: 'notebook',
      seen: 2,
      facts: ['1号跳预'],
      reads: [{ seat: 1, guess: 'seer', conf: 3, why: '跳了' }],
      note: '我要追问1号的查验'
    }
  }];
  let prompt = '';
  await specFor('werewolf').runTurn({
    actor: { id: 'u4', username: 'bot', kind: 'agent' },
    legalActions: [{ name: 'speak' }],
    privateView: view,
    complete: async (request) => {
      prompt = request.messages.map((message) => message.content).join('\n');
      return {
        ok: true,
        text: JSON.stringify({
          thought: '接1号',
          reactTo: '1号跳预',
          reads: [],
          say: '1号你跳预了，把查验过程说清楚。3号你怎么解释这张查杀？'
        })
      };
    },
    memory: { read: () => memory, append() {} }
  });
  assert.match(prompt, /我要追问1号的查验/);
  // 发言必须落在证据上：旧版靠「会被当成狼」施压，新版要求先摆矛盾再下判断。
  assert.match(prompt, /只点名不给依据不算推理|不是走过场/);
  assert.match(prompt, /狼人要藏/);
});
