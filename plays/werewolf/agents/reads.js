'use strict';

// 每个 Agent 自己的身份预测表。只存在该 actor 的 memory 里，
// 不进 visibility、不进频道快照。引擎不会把别人的真身份写进来；
// 已知事实只有：自己、狼队友、预言家自己的查验。

const GUESSES = new Set(['wolf', 'good', 'seer', 'witch', 'hunter', 'villager', 'unknown']);

const READS_TOOL = {
  type: 'function',
  function: {
    name: 'update_reads',
    description: '更新你对场上每个人的身份判断。每次行动前都要先调用。只写你现在的看法和理由，不要写只有上帝才知道的真身份。',
    parameters: {
      type: 'object',
      properties: {
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              seat: { type: 'integer', description: '座位号' },
              guess: {
                type: 'string',
                enum: [...GUESSES],
                description: 'wolf=狼 good/villager=好人 seer/witch/hunter=具体神职 unknown=未知'
              },
              conf: { type: 'integer', description: '1-5，5 是铁' },
              why: { type: 'string', description: '根据哪句发言、哪张票、哪个夜信息' }
            },
            required: ['seat', 'guess', 'why']
          }
        }
      },
      required: ['notes']
    }
  }
};

function guessForRole(role) {
  if (role === 'werewolf') return 'wolf';
  if (role === 'villager') return 'villager';
  if (role === 'seer' || role === 'witch' || role === 'hunter') return role;
  return 'unknown';
}

function clampConf(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function bodies(memory) {
  return (memory || []).map((entry) => (entry && entry.body !== undefined ? entry.body : entry)).filter(Boolean);
}

function latestReads(memory) {
  const rows = bodies(memory);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === 'notebook' && Array.isArray(row.reads)) return row.reads;
    if (row?.kind === 'reads' && Array.isArray(row.table)) return row.table;
  }
  return null;
}

function seedKnown(view) {
  const selfId = view?.self?.id;
  const table = (view?.seats || []).map((seat) => ({
    id: seat.id,
    seat: seat.seat,
    guess: seat.id === selfId ? guessForRole(view.self?.role) : 'unknown',
    conf: seat.id === selfId ? 5 : 1,
    why: seat.id === selfId ? '我自己' : '开局未知',
    locked: seat.id === selfId
  }));
  for (const mate of view?.wolf?.team || []) {
    if (mate.isSelf) continue;
    const row = table.find((item) => item.seat === mate.seat);
    if (!row) continue;
    row.guess = 'wolf';
    row.conf = 5;
    row.why = '狼队友';
    row.locked = true;
  }
  for (const check of view?.seer?.checks || []) {
    const row = table.find((item) => item.seat === check.targetSeat);
    if (!row) continue;
    row.guess = check.isWolf ? 'wolf' : 'good';
    row.conf = 5;
    row.why = `第${check.night}夜查验`;
    row.locked = true;
  }
  return table;
}

function overlay(base, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return base;
  const next = base.map((row) => ({ ...row }));
  for (const note of incoming) {
    const seatNo = Number(note?.seat);
    const row = next.find((item) => item.seat === seatNo);
    if (!row || row.locked) continue;
    const guess = GUESSES.has(note.guess) ? note.guess : row.guess;
    row.guess = guess;
    row.conf = clampConf(note.conf, row.conf);
    const why = String(note.why || '').trim().slice(0, 80);
    if (why) row.why = why;
  }
  return next;
}

function tableFor(view, memory, incoming) {
  const seeded = seedKnown(view);
  const saved = latestReads(memory);
  const merged = saved ? overlay(seeded, saved) : seeded;
  return overlay(merged, incoming);
}

function notesFromCall(call) {
  const fn = call?.function || call;
  if ((fn?.name || call?.name) !== 'update_reads') return null;
  const args = parseArgs(fn?.arguments ?? call?.arguments);
  const notes = args.notes || args.table;
  return Array.isArray(notes) ? notes : null;
}

function label(guess, locked) {
  if (locked && guess === 'wolf') return '狼队友';
  if (guess === 'wolf') return '狼坑';
  if (guess === 'good' || guess === 'villager') return '好人';
  if (guess === 'seer' || guess === 'witch' || guess === 'hunter') return '神坑';
  return '未知';
}

function formatReads(table) {
  if (!Array.isArray(table) || !table.length) return '';
  const lines = ['你的身份预测表（只有你看得见，下回合还会带上；根据发言和票型改）：'];
  for (const row of table) {
    lines.push(`${row.seat}号 ${label(row.guess, row.locked)} 信心${row.conf}：${row.why}`);
  }
  const wolfSeats = table.filter((row) => row.guess === 'wolf').map((row) => row.seat);
  const godSeats = table.filter((row) => row.guess === 'seer' || row.guess === 'witch' || row.guess === 'hunter').map((row) => row.seat);
  if (wolfSeats.length) lines.push(`你目前的狼坑：${wolfSeats.join('、')}号（板上共 3 狼）。`);
  if (godSeats.length) lines.push(`你目前的神坑：${godSeats.join('、')}号。`);
  lines.push('投票、夜间刀人、发言都按这张表，不要因为别人票多就改判断。');
  return lines.join('\n');
}

function pickFromReads(table, legalTargets, prefer) {
  const allowed = new Set(legalTargets);
  const ranked = [...(table || [])]
    .filter((row) => allowed.has(row.id) && !row.locked)
    .sort((left, right) => {
      const leftHit = prefer(left) ? 1 : 0;
      const rightHit = prefer(right) ? 1 : 0;
      if (leftHit !== rightHit) return rightHit - leftHit;
      return right.conf - left.conf;
    });
  return ranked[0] || null;
}

module.exports = {
  READS_TOOL,
  latestReads,
  seedKnown,
  tableFor,
  notesFromCall,
  formatReads,
  pickFromReads,
  guessForRole
};
