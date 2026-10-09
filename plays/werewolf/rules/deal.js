'use strict';

const { roleCount } = require('./boards');

// 洗牌发身份。不使用 Math.random()：熵来自注入的 randomId()，
// 测试传入固定 randomId 即可复现同一副牌。
function seedFrom(text) {
  let hash = 2166136261; // FNV-1a
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, next) {
  const deck = [...items];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function buildDeck(board) {
  const deck = [];
  for (const [role, count] of Object.entries(board.roles)) {
    for (let index = 0; index < count; index += 1) deck.push(role);
  }
  return deck;
}

// seats: [{ id, username, kind }]，顺序即座位号。返回带 role 的新数组，不改原数组。
function deal(board, seats, seedText) {
  if (!Array.isArray(seats) || seats.length !== roleCount(board)) {
    throw new Error(`board "${board.id}" needs ${roleCount(board)} seats, got ${seats?.length}`);
  }
  const next = mulberry32(seedFrom(seedText));
  const deck = shuffle(buildDeck(board), next);
  return seats.map((seat, index) => ({
    id: seat.id,
    username: seat.username,
    kind: seat.kind === 'agent' ? 'agent' : 'human',
    seat: index + 1,
    role: deck[index],
    alive: true,
    deathCause: null,
    deathNight: 0
  }));
}

// 首日发言人：同一副牌对应同一个起始位，之后每天顺延（等价于线下死左/死右轮换）。
function firstSpeakerIndex(seats, seedText) {
  const next = mulberry32(seedFrom(`${seedText}:speaker`));
  return Math.floor(next() * seats.length);
}

module.exports = { deal, shuffle, buildDeck, seedFrom, mulberry32, firstSpeakerIndex };
