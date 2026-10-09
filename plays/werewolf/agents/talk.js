'use strict';

// 一轮「观察 → 内心判断 → 反应」。
// 不是多步 ReAct 去搜信息：桌上公开信息已经在 briefing 里。
// 缺的是接上一句人话，而不是对着 JSON 工具列表编套话。

const { extractJson, isLegalAction } = require('../../../src/play/agent');
const {
  BOARD_RULES, roleName, aliveLine
} = require('../prompts/rules');

const WIN_DRIVE = `你的目标是赢：好人要找出所有狼人并放逐，狼人要让自己不被发现直到数量上占优势。每一句话都要为这个目标服务。`;

const SPEAK_OR_DIE = `沉默等于自杀：不发言的人最容易被贴上「无害=好人」的标签来保护，或「不说话=有鬼」来放逐。你必须开口，即使信息不足。`;

function waitingLine(view) {
  const waiting = (view?.seats || []).filter((s) => s.alive && s.waitingToSpeak);
  if (!waiting.length) return '';
  return `等待发言：${waiting.map((s) => s.seat).join('、')} 号。`;
}

function speechesThisRound(view) {
  const log = view?.log || [];
  // find the last dawn entry index, speeches after that are "this round"
  let lastDawnIdx = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].kind === 'dawn' || log[i].kind === 'roundStart') { lastDawnIdx = i; break; }
  }
  return log.slice(lastDawnIdx + 1).filter((e) => e.kind === 'speech');
}

const TRANSCRIPT_BUDGET = 6000; // chars

function fullTranscript(view) {
  const selfSeat = view?.self?.seat;
  const speeches = (view?.log || []).filter((e) => e.kind === 'speech');
  if (!speeches.length) return '（本局还没有人发言）';
  const lines = speeches.map((e) => {
    const tag = e.seat === selfSeat ? '（你）' : '';
    return `${e.seat}号${tag}：「${e.text}」`;
  });
  // trim from the front if over budget, and say so
  let total = lines.reduce((n, l) => n + l.length, 0);
  let dropped = 0;
  while (lines.length > 1 && total > TRANSCRIPT_BUDGET) {
    total -= lines[0].length;
    lines.shift();
    dropped += 1;
  }
  const prefix = dropped ? `（前面的内容没有给你，只保留最近 ${lines.length} 条）\n` : '';
  return prefix + lines.join('\n');
}
const { tableFor, formatReads } = require('./reads');
const { latestNotebook, formatNotebook } = require('./notebook');

const VOICES = [
  '冲，短句，爱顶刚才说话的人',
  '慢，先复述别人原话再下判断',
  '先轻轻同意一句，再转折',
  '爱追问：你凭什么这么说',
  '后置位口吻，爱归票、爱收束',
  '话不多，但每句点名带理由'
];

function voiceFor(view) {
  const seat = Number(view?.self?.seat) || 1;
  return VOICES[(seat - 1) % VOICES.length];
}

function lastSpeech(view) {
  const speeches = speechesThisRound(view);
  return speeches.length ? speeches[speeches.length - 1] : null;
}

function timelineLine(view) {
  const lines = [];
  for (const entry of view?.log || []) {
    if (entry.kind === 'dawn') {
      if (entry.deaths?.length) {
        lines.push(`【第 ${entry.night} 夜结果】${entry.deaths.join('、')} 号出局`);
      } else {
        lines.push(`【第 ${entry.night} 夜结果】平安夜`);
      }
    } else if (entry.kind === 'voteResult') {
      if (entry.outcome === 'exile' && entry.exiledSeat != null) {
        const tally = (entry.detail || []).map((d) =>
          `${(d.voterSeats || []).join('、')}号→${d.targetSeat}号`
        ).join('，');
        const abstain = entry.abstainSeats?.length ? `，弃票：${entry.abstainSeats.join('、')}号` : '';
        lines.push(`${tally}${abstain}；${entry.exiledSeat} 号被放逐`);
      } else if (entry.outcome === 'none') {
        lines.push('平票，无人被放逐');
      }
    } else if (entry.kind === 'hunterShot') {
      lines.push(`猎人 ${entry.shooterSeat ?? ''} 号开枪，带走 ${entry.target ?? entry.targetSeat} 号`);
    }
  }
  return lines.join('\n');
}

function dawnLine(view) {
  const dawn = [...(view?.log || [])].reverse().find((entry) => entry.kind === 'dawn');
  if (!dawn) return '夜晚结果还没公布。';
  return dawn.deaths?.length ? `昨晚出局：${dawn.deaths.join('、')}号（不公布死因）。` : '昨晚平安夜。';
}

function briefing(view, roleGuidance, readsText, notebookText) {
  const self = view?.self;
  const last = lastSpeech(view);
  const react = last
    ? `上一句是 ${last.seat}号说的：「${last.text}」。你出口的话必须接这一句：同意、反驳或追问，不许装作没听见。`
    : '你是本轮较早开口的人。只谈昨晚和自己的位置，不要给还没说话的人扣「发言空」。';
  return [
    `你是 ${self?.seat} 号，身份是${roleName(self?.role)}。口吻：${voiceFor(view)}。`,
    aliveLine(view),
    dawnLine(view),
    timelineLine(view),
    waitingLine(view),
    '',
    fullTranscript(view),
    '',
    react,
    '',
    '上面的记录里，标了「（你）」的是你自己说过的话。接着自己的立场往下说，前后要对得上。',
    '',
    readsText,
    '',
    notebookText,
    '',
    roleGuidance
  ].filter(Boolean).join('\n');
}

const THINK_RULES = `现在是内心独白，不要调用工具，只输出一个 JSON 对象：
{
  "evidence": ["3号说「5号是狼」但自己投了6号", "第1夜死的是7号，7号昨天保过3号"],
  "thought": "从证据推出的判断：3号的发言和票对不上，像是狼在悍跳",
  "reactTo": "你在回应谁的哪一句，没有上一句就写昨晚",
  "reads": [{"seat":3,"guess":"wolf","conf":4,"why":"他刚才那句站边和票对不上"}],
  "say": "要说出口的口语中文",
  "targetSeat": 3
}

先写 evidence 再写 thought：evidence 只能是你这份 view 里真实存在的事实（谁说了哪句、谁投了谁、哪晚死了谁），不许编造。
thought 必须是从 evidence 推出来的，说不通就老实写「信息不足」。
say 是 thought 的口语版：至少引用一条 evidence 里的具体事实，再给出你的结论。只点名不给依据不算推理，不是走过场。
有上一句就必须接（同意、反驳或追问），禁止装作没听见。禁止「我先过」「听听后面的」「没想法」。
禁止说还没开口的人发言空。不这样说会被当成狼。
targetSeat 在投票或夜间刀人时填座位号；纯发言可省略。
不要 Markdown，不要解释。`;

function parsePlan(text) {
  const plan = extractJson(text);
  if (!plan || typeof plan !== 'object') return null;
  const say = typeof plan.say === 'string' ? plan.say.trim() : '';
  const thought = typeof plan.thought === 'string' ? plan.thought.trim() : '';
  const reactTo = typeof plan.reactTo === 'string' ? plan.reactTo.trim() : '';
  const reads = Array.isArray(plan.reads) ? plan.reads : [];
  const evidence = Array.isArray(plan.evidence)
    ? plan.evidence.map((line) => String(line || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const targetSeat = Number.isInteger(Number(plan.targetSeat)) ? Number(plan.targetSeat) : null;
  return { evidence, thought, reactTo, reads, say, targetSeat };
}

function actionFromPlan(plan, ctx) {
  const legal = ctx.legalActions || [];
  const view = ctx.privateView || {};
  const seats = view.seats || [];
  const targetId = plan.targetSeat
    ? seats.find((seat) => seat.seat === plan.targetSeat)?.id
    : null;

  const speak = legal.find((action) => action.name === 'speak');
  if (speak && plan.say) {
    return { name: 'speak', payload: { text: plan.say } };
  }

  if (targetId) {
    const named = ['vote', 'wolfPick', 'seerCheck', 'witchPoison', 'hunterShoot']
      .map((name) => legal.find((action) => action.name === name && action.payload?.target === targetId))
      .find(Boolean);
    if (named) return { name: named.name, payload: { ...named.payload } };
  }

  if (plan.say && speak) return { name: 'speak', payload: { text: plan.say } };
  return null;
}

async function planAndAct(ctx, { guidance }) {
  if (typeof ctx.complete !== 'function') return null;
  const view = ctx.privateView || {};
  const legal = ctx.legalActions || [];
  const actionable = legal.some((action) => ['speak', 'vote', 'wolfPick', 'seerCheck', 'witchPoison', 'hunterShoot'].includes(action.name));
  if (!actionable) return null;

  const memory = ctx.memory?.read?.() || [];
  const table = tableFor(view, memory);
  const roleGuidance = typeof guidance === 'function' ? guidance(view) : '';
  const user = briefing(view, roleGuidance, formatReads(table), formatNotebook(latestNotebook(memory)));

  const result = await ctx.complete({
    messages: [
      { role: 'system', content: [BOARD_RULES, WIN_DRIVE, SPEAK_OR_DIE, THINK_RULES].join('\n\n') },
      { role: 'user', content: user }
    ],
    maxTokens: 1200,
    timeoutMs: ctx.timeoutMs || 25_000,
    enableThinking: false
  });
  if (!result || result.ok !== true || !result.text) return null;

  let plan;
  try { plan = parsePlan(result.text); } catch { return null; }
  if (!plan) return null;

  if (plan.reads.length) {
    const next = tableFor(view, ctx.memory?.read?.() || [], plan.reads);
    ctx.memory?.append?.({ kind: 'reads', table: next, thought: plan.thought, reactTo: plan.reactTo });
  }

  const action = actionFromPlan(plan, ctx);
  if (!action || !isLegalAction(action, legal)) return null;
  ctx.memory?.append?.({
    kind: 'plan', thought: plan.thought, reactTo: plan.reactTo, say: plan.say, evidence: plan.evidence
  });
  return action;
}

module.exports = { briefing, parsePlan, actionFromPlan, planAndAct, voiceFor, lastSpeech, THINK_RULES };
