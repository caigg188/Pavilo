'use strict';

const { DEATH, ROLES } = require('./boards');
const { checkVictory } = require('./victory');

// 狼人提名 → 今晚刀口。平票视为空刀（规则：无法统一意见即空刀）。
// picks: Map<wolfSeatId, targetSeatId|null>，null 表示明确空刀。
function tallyWolfPicks(picks) {
  const counts = new Map();
  for (const target of picks.values()) {
    if (!target) continue;
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  if (counts.size === 0) return { target: null, tie: false, counts };
  let best = -1;
  let winners = [];
  for (const [target, count] of counts) {
    if (count > best) { best = count; winners = [target]; }
    else if (count === best) winners.push(target);
  }
  if (winners.length !== 1) return { target: null, tie: true, counts };
  return { target: winners[0], tie: false, counts };
}

function seatById(seats, id) { return seats.find((seat) => seat.id === id) || null; }

function kill(seats, targetId, cause, night) {
  const next = seats.map((seat) => (seat.id === targetId && seat.alive
    ? { ...seat, alive: false, deathCause: cause, deathNight: night }
    : seat));
  const died = next.find((seat) => seat.id === targetId && !seat.alive
    && seat.deathCause === cause && seat.deathNight === night);
  return { seats: next, died: died && seatById(seats, targetId)?.alive ? died : null };
}

// 夜间分段结算。
//
// 「狼刀在先」是硬规则：狼刀达成胜利条件后直接判狼胜，
// 女巫随后毒死最后一只狼、或猎人开枪带走最后一只狼，都不再改变结果。
// 因此每一段死亡之后必须单独 checkVictory，不能等全部结算完再判一次。
//
// input: { wolfTarget, witchSave, witchPoison, night }
// 返回 { seats, deaths, victory, pendingHunter }
function resolveNight(seats, board, input) {
  const night = input.night || 1;
  let current = seats;
  const deaths = [];

  // 第 1 段：狼刀。被解药救下则不死。
  if (input.wolfTarget && !(input.witchSave && input.witchSave === input.wolfTarget)) {
    const result = kill(current, input.wolfTarget, DEATH.WOLF, night);
    if (result.died) { current = result.seats; deaths.push(result.died); }
  }
  let victory = checkVictory(current, board);
  if (victory.over) return { seats: current, deaths, victory, pendingHunter: null };

  // 第 2 段：女巫毒药。
  if (input.witchPoison) {
    const result = kill(current, input.witchPoison, DEATH.POISON, night);
    if (result.died) { current = result.seats; deaths.push(result.died); }
    victory = checkVictory(current, board);
    if (victory.over) return { seats: current, deaths, victory, pendingHunter: null };
  }

  // 第 3 段：猎人开枪由 machine 在独立阶段处理（需要玩家选目标）。
  // 这里只判定「谁有资格开枪」，不代其决策。
  const pendingHunter = deaths.find((seat) => seat.role === ROLES.HUNTER
    && board.hunterCanShoot[seat.deathCause]) || null;

  return { seats: current, deaths, victory, pendingHunter: pendingHunter ? pendingHunter.id : null };
}

// 猎人开枪结算（白天放逐后也复用）。
function resolveHunterShot(seats, board, hunterId, targetId, night) {
  if (!targetId) return { seats, deaths: [], victory: checkVictory(seats, board) };
  const shooter = seatById(seats, hunterId);
  if (!shooter || shooter.role !== ROLES.HUNTER) {
    return { seats, deaths: [], victory: checkVictory(seats, board) };
  }
  const result = kill(seats, targetId, DEATH.HUNTER, night);
  const deaths = result.died ? [result.died] : [];
  return { seats: result.seats, deaths, victory: checkVictory(result.seats, board) };
}

// 白天放逐结算。
function resolveExile(seats, board, targetId, night) {
  if (!targetId) return { seats, deaths: [], victory: checkVictory(seats, board), pendingHunter: null };
  const result = kill(seats, targetId, DEATH.EXILE, night);
  const deaths = result.died ? [result.died] : [];
  const victory = checkVictory(result.seats, board);
  if (victory.over) return { seats: result.seats, deaths, victory, pendingHunter: null };
  const pendingHunter = result.died && result.died.role === ROLES.HUNTER
    && board.hunterCanShoot[DEATH.EXILE] ? result.died.id : null;
  return { seats: result.seats, deaths, victory, pendingHunter };
}

module.exports = { tallyWolfPicks, resolveNight, resolveHunterShot, resolveExile, kill, seatById };
