'use strict';

// 每个 Agent 一份自己的对局笔记，只存在该 actor 的 memory 里。
// 引擎不替他们下判断：有新的死讯、发言、放逐、开枪时，由模型改写这份笔记。
// 笔记可以追加，也可以改掉过时的条目。已知事实（自己、狼队友、自己的查验）锁死。

const { extractJson } = require('../../../src/play/agent');
const { roleName } = require('../prompts/rules');
const { tableFor } = require('./reads');

const REFLECT_SYSTEM = `你在维护只属于你自己的狼人杀笔记。不要调用工具，只输出一个 JSON 对象：
{
  "facts": ["第1夜平安", "1号发言：我是预言家，查杀2号"],
  "reads": [{"seat":2,"guess":"wolf","conf":4,"why":"被1号报查杀"}],
  "note": "我这轮要站1号，并追问2号"
}
facts 是你记住的局面，最多 12 条。还成立的旧事实留着，过时的改掉或删掉，新事实补进去。
reads 只写你有看法的座位。guess 用 wolf、good、seer、witch、hunter、villager、unknown。conf 是 1 到 5。
note 是你此刻的策略，一两句，给下一回自己的发言用。
这是私密笔记。狼人可以在笔记里记住队友，但 note 不要写成能直接当发言念出来的暴露句。`;

function unwrap(memory) {
  return (memory || []).map((entry) => (entry && entry.body !== undefined ? entry.body : entry)).filter(Boolean);
}

function latestNotebook(memory) {
  const rows = unwrap(memory);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.kind === 'notebook') return rows[index];
  }
  return null;
}

function seatNo(view, id) {
  return (view?.seats || []).find((seat) => seat.id === id)?.seat ?? null;
}

// 压成「新发生了什么」。不包含身份，只包含这个视图里已经允许看见的信息。
function digest(view) {
  const lines = [];
  for (const entry of view?.log || []) {
    if (entry.kind === 'dawn') {
      lines.push(entry.deaths?.length
        ? `第${entry.night}夜出局：${entry.deaths.join('、')}号（不公布死因）`
        : `第${entry.night}夜平安`);
    } else if (entry.kind === 'speech') {
      lines.push(`${entry.seat}号发言：${entry.text}`);
    } else if (entry.kind === 'voteResult' && entry.outcome === 'exile') {
      lines.push(entry.exiledSeat ? `白天放逐了${entry.exiledSeat}号` : '白天放逐了一名玩家');
      for (const row of entry.detail || []) {
        if (row.targetSeat) lines.push(`票型：${row.voterSeats.join('、')}号投了${row.targetSeat}号`);
      }
    } else if (entry.kind === 'voteResult' && entry.outcome === 'tie') {
      const tied = (entry.tied || []).map((id) => seatNo(view, id) || id).filter(Boolean);
      lines.push(tied.length ? `投票平票：${tied.join('、')}号` : '投票平票');
    } else if (entry.kind === 'voteResult') {
      lines.push('这一轮投票无人出局');
    } else if (entry.kind === 'hunterShot') {
      lines.push(entry.target ? `猎人开枪带走了${entry.target}号` : '猎人开枪');
    }
  }
  for (const line of view?.wolf?.chat || []) {
    lines.push(`狼队私聊 ${line.seat}号：${line.text}`);
  }
  return lines;
}

function isMemoryEvent(entry) {
  return entry?.kind === 'speech' || entry?.kind === 'dawn'
    || entry?.kind === 'voteResult' || entry?.kind === 'hunterShot';
}

function cleanList(value, limit, maxLen) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = String(item || '').trim().slice(0, maxLen);
    if (!text) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function notebookFromModel(text) {
  let raw;
  try { raw = extractJson(text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hasFacts = Array.isArray(raw.facts);
  const hasNote = typeof raw.note === 'string';
  if (!hasFacts && !hasNote) return null;
  return {
    facts: cleanList(raw.facts, 12, 160),
    reads: Array.isArray(raw.reads) ? raw.reads : [],
    note: hasNote ? raw.note.trim().slice(0, 240) : ''
  };
}

function knownLines(view) {
  const lines = [];
  const self = view?.self;
  if (self) lines.push(`你是 ${self.seat} 号，身份是${roleName(self.role)}。这是事实，不能改。`);
  for (const mate of view?.wolf?.team || []) {
    if (!mate.isSelf) lines.push(`${mate.seat} 号是你的狼队友。这是事实。`);
  }
  for (const check of view?.seer?.checks || []) {
    lines.push(`第 ${check.night} 夜你查验 ${check.targetSeat} 号，结果是${check.isWolf ? '狼人' : '好人'}。`);
  }
  return lines;
}

function formatNotebook(notebook) {
  if (!notebook) {
    return '你还没有这局的笔记。看到死讯、发言、放逐之后，先写出自己的猜测，再行动。';
  }
  const facts = notebook.facts?.length ? notebook.facts.map((line) => `- ${line}`).join('\n') : '- （还没有记下事实）';
  return [
    '你的对局笔记（只有你看得见，之后每一回合都会带上；可以改）：',
    facts,
    notebook.note ? `此刻打算：${notebook.note}` : '此刻打算：还没写。'
  ].join('\n');
}

// 有新事实才叫模型改笔记。失败时不推进 seen，下一回合还能再试。
// 返回 true 表示已经跟上，或这次写成了新笔记。
async function reviseMemory(ctx) {
  const view = ctx?.privateView || {};
  const memory = ctx?.memory?.read?.() || [];
  const facts = digest(view);
  const prev = latestNotebook(memory);
  const seen = Number(prev?.seen) || 0;
  if (facts.length <= seen) return true;
  if (typeof ctx.complete !== 'function') return false;

  const fresh = facts.slice(seen);
  const result = await ctx.complete({
    messages: [
      { role: 'system', content: REFLECT_SYSTEM },
      {
        role: 'user',
        content: [
          knownLines(view).join('\n'),
          '',
          prev ? `旧笔记：\n${(prev.facts || []).join('\n')}\n打算：${prev.note || '无'}` : '旧笔记：无',
          '',
          '新发生的事：',
          fresh.join('\n')
        ].join('\n')
      }
    ],
    maxTokens: 500,
    timeoutMs: ctx.timeoutMs || 20_000,
    enableThinking: false
  });
  if (!result || result.ok !== true || !result.text) return false;

  const parsed = notebookFromModel(result.text);
  if (!parsed) return false;
  const keptFacts = parsed.facts.length ? parsed.facts : [...(prev?.facts || []), ...fresh].slice(-12);
  const locked = tableFor(view, [], parsed.reads);
  const notebook = {
    kind: 'notebook',
    seen: facts.length,
    facts: keptFacts,
    reads: locked.map((row) => ({
      seat: row.seat, guess: row.guess, conf: row.conf, why: row.why
    })),
    note: parsed.note || prev?.note || ''
  };
  ctx.memory?.append?.(notebook);
  return true;
}

module.exports = {
  REFLECT_SYSTEM,
  latestNotebook,
  digest,
  isMemoryEvent,
  notebookFromModel,
  formatNotebook,
  reviseMemory
};
