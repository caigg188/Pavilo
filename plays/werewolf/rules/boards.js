'use strict';

// 板子定义与角色常量。纯数据，无 IO。
const ROLES = Object.freeze({
  SEER: 'seer',
  WITCH: 'witch',
  HUNTER: 'hunter',
  VILLAGER: 'villager',
  WEREWOLF: 'werewolf'
});

const GOD_ROLES = Object.freeze(new Set([ROLES.SEER, ROLES.WITCH, ROLES.HUNTER]));
const WOLF_ROLES = Object.freeze(new Set([ROLES.WEREWOLF]));

// 死因。猎人能否开枪按死因区分：被毒杀不能开枪。
const DEATH = Object.freeze({
  WOLF: 'wolf',
  POISON: 'poison',
  EXILE: 'exile',
  HUNTER: 'hunter'
});

const CAMP = Object.freeze({ GOOD: 'good', WOLF: 'wolf' });

function campOf(role) { return WOLF_ROLES.has(role) ? CAMP.WOLF : CAMP.GOOD; }
function isGod(role) { return GOD_ROLES.has(role); }
function isWolf(role) { return WOLF_ROLES.has(role); }
function isVillager(role) { return role === ROLES.VILLAGER; }

// 9 人标准局：3 神（预女猎）+ 3 民 + 3 狼。首版不做警长。
const STD9 = Object.freeze({
  id: 'std9',
  seats: 9,
  roles: Object.freeze({ seer: 1, witch: 1, hunter: 1, villager: 3, werewolf: 3 }),
  // 'edge' 屠边（神全灭或民全灭即狼胜）｜ 'town' 屠城（好人全灭才狼胜）
  victory: 'edge',
  // 女巫仅第 1..N 夜可自救；0 = 永不可自救
  witchSelfSaveNight: 1,
  // 同夜是否允许解药 + 毒药一起用
  witchDoublePotion: false,
  // 哪些夜晚的死者有遗言（白天被放逐者始终有遗言）
  lastWordsNights: Object.freeze([1]),
  // 猎人按死因能否开枪
  hunterCanShoot: Object.freeze({ [DEATH.WOLF]: true, [DEATH.EXILE]: true, [DEATH.POISON]: false }),
  timers: Object.freeze({
    nightActions: 60_000,
    nightWitch: 30_000,
    dawn: 5_000,
    lastWords: 60_000,
    hunterShot: 30_000,
    daySpeech: 90_000,
    dayVote: 30_000,
    voteResult: 5_000,
    pkSpeech: 60_000,
    pkVote: 30_000,
    exileLastWords: 60_000
  })
});

const BOARDS = new Map([[STD9.id, STD9]]);

function getBoard(id) { return BOARDS.get(id) || null; }
function boardIds() { return [...BOARDS.keys()]; }
function roleCount(board) { return Object.values(board.roles).reduce((total, count) => total + count, 0); }

function canHunterShoot(board, cause) { return Boolean(board.hunterCanShoot[cause]); }
function hasLastWords(board, night) { return board.lastWordsNights.includes(night); }
// 女巫自救：9 人标准局只有首夜可以。
function witchMaySelfSave(board, night) {
  return board.witchSelfSaveNight > 0 && night <= board.witchSelfSaveNight;
}

module.exports = {
  ROLES, GOD_ROLES, WOLF_ROLES, DEATH, CAMP, STD9, BOARDS,
  campOf, isGod, isWolf, isVillager,
  getBoard, boardIds, roleCount, canHunterShoot, hasLastWords, witchMaySelfSave
};
