'use strict';

// 计票。votes: Map<voterSeatId, targetSeatId|null>，null = 弃票。
// 唱票公开：谁投了谁全部公开（标准规则）。
function tally(votes) {
  const counts = new Map();
  const detail = new Map();
  let abstain = 0;
  for (const [voter, target] of votes) {
    if (!target) { abstain += 1; continue; }
    counts.set(target, (counts.get(target) || 0) + 1);
    if (!detail.has(target)) detail.set(target, []);
    detail.get(target).push(voter);
  }
  let best = 0;
  let leaders = [];
  for (const [target, count] of counts) {
    if (count > best) { best = count; leaders = [target]; }
    else if (count === best) leaders.push(target);
  }
  return { counts, detail, abstain, top: best, leaders };
}

// 一轮投票的裁决。
// - 唯一最高票 → 放逐
// - 多人并列最高 → 平票，进 PK
// - 全员弃票 → 无人出局
function resolveVote(votes) {
  const result = tally(votes);
  if (result.leaders.length === 0) return { ...result, outcome: 'none', exiled: null, tied: [] };
  if (result.leaders.length === 1) return { ...result, outcome: 'exile', exiled: result.leaders[0], tied: [] };
  return { ...result, outcome: 'tie', exiled: null, tied: [...result.leaders] };
}

// PK 轮：平票者本人不投。
// 边界：3 人存活投出 1-1-1 时三人全进 PK，合法投票人为零 —— 直接判无人出局，
// 否则会卡死在 pk_vote 等一组永远不会到来的票。
function pkVoters(seats, tied) {
  const tiedSet = new Set(tied);
  return seats.filter((seat) => seat.alive && !tiedSet.has(seat.id)).map((seat) => seat.id);
}

function resolvePkVote(votes, seats, tied) {
  if (pkVoters(seats, tied).length === 0) {
    return { counts: new Map(), detail: new Map(), abstain: 0, top: 0, leaders: [],
      outcome: 'none', exiled: null, tied: [] };
  }
  const result = resolveVote(votes);
  // 再次平票：本轮无人出局，不再无限 PK。
  if (result.outcome === 'tie') return { ...result, outcome: 'none', exiled: null };
  return result;
}

module.exports = { tally, resolveVote, resolvePkVote, pkVoters };
