'use strict';

const { isGod, isWolf, isVillager, CAMP } = require('./boards');

const REASON = Object.freeze({
  ALL_WOLVES_DEAD: 'ALL_WOLVES_DEAD',
  GODS_WIPED: 'GODS_WIPED',
  VILLAGERS_WIPED: 'VILLAGERS_WIPED',
  TOWN_WIPED: 'TOWN_WIPED',
  UNSTOPPABLE: 'UNSTOPPABLE'
});

const ONGOING = Object.freeze({ over: false, winner: null, reason: null });

// 胜负判定。seats 是当前座位数组（含 alive / role）。
// 顺序有意义：狼全灭优先于任何屠边条件——最后一狼与最后一民同归于尽时判好人胜。
function checkVictory(seats, board) {
  const alive = seats.filter((seat) => seat.alive);
  const wolves = alive.filter((seat) => isWolf(seat.role)).length;
  const gods = alive.filter((seat) => isGod(seat.role)).length;
  const villagers = alive.filter((seat) => isVillager(seat.role)).length;
  const good = gods + villagers;

  if (wolves === 0) return { over: true, winner: CAMP.GOOD, reason: REASON.ALL_WOLVES_DEAD };
  if (board.victory === 'edge') {
    if (gods === 0) return { over: true, winner: CAMP.WOLF, reason: REASON.GODS_WIPED };
    if (villagers === 0) return { over: true, winner: CAMP.WOLF, reason: REASON.VILLAGERS_WIPED };
  } else if (good === 0) {
    return { over: true, winner: CAMP.WOLF, reason: REASON.TOWN_WIPED };
  }
  // 狼数已经压过好人：再走流程也翻不回来，提前终局。
  if (wolves >= good) return { over: true, winner: CAMP.WOLF, reason: REASON.UNSTOPPABLE };
  return ONGOING;
}

function campCounts(seats) {
  const alive = seats.filter((seat) => seat.alive);
  return {
    wolves: alive.filter((seat) => isWolf(seat.role)).length,
    gods: alive.filter((seat) => isGod(seat.role)).length,
    villagers: alive.filter((seat) => isVillager(seat.role)).length
  };
}

module.exports = { checkVictory, campCounts, REASON, ONGOING };
