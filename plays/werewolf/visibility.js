'use strict';

const { ROLES, isWolf, witchMaySelfSave } = require('./rules/boards');
const { PHASES, NIGHT_PHASES } = require('./rules/phases');

// ★ 安全核心 ★
//
// 所有发往浏览器和 Agent 的状态，必须且只能经过本文件。
// host.snapshot(actor) 与 Agent 的 privateView 走同一个 viewFor()
// （src/play/runtime.js 用 host.snapshot(actor) 构造 Agent 上下文），
// 因此 Agent 天然没有上帝视角 —— 这是架构保证，不是提示词约束。
//
// 不变量：
//   1. 狼队友身份只出现在狼的 view
//   2. 预言家查验结果只出现在预言家的 view
//   3. 女巫看到的刀口不出现在任何其他 view
//   4. 死者 view 不含他人身份，直到 game_over
//   5. 任何 visibility:'channel' 快照都不含 role / 私密字段

// 公开座位信息：任何人、任何阶段都可见。绝不含 role。
function publicSeat(seat) {
  return {
    id: seat.id,
    seat: seat.seat,
    username: seat.username,
    kind: seat.kind,
    alive: seat.alive,
    // 死因公开会泄露信息（被毒 = 场上有女巫且已用毒），只在终局公布。
    dead: !seat.alive
  };
}

// 终局揭晓：此时才允许暴露全部身份。
function revealedSeat(seat) {
  return { ...publicSeat(seat), role: seat.role, deathCause: seat.deathCause, deathNight: seat.deathNight };
}

function publicPhase(state) {
  return {
    name: state.phase,
    night: state.night,
    day: state.day,
    deadline: state.deadline || null,
    currentSpeaker: state.currentSpeaker || null
  };
}

// 频道级公开快照。发给频道内所有 human peer，绝不含任何身份信息。
function channelView(state) {
  const over = state.phase === PHASES.GAME_OVER;
  return {
    gameId: state.gameId,
    boardId: state.boardId,
    phase: publicPhase(state),
    seats: state.seats.map((seat) => (over ? revealedSeat(seat) : publicSeat(seat))),
    // 开局前的候补名单。只有 id/名字/人机，没有身份可泄漏。
    lobby: (state.lobby || []).map((entry) => ({ id: entry.id, username: entry.username, kind: entry.kind })),
    log: state.publicLog || [],
    ...(over ? { result: state.result || null } : {})
  };
}

function findSeat(state, actorId) {
  return state.seats.find((seat) => seat.id === actorId) || null;
}

// 狼队友：只有狼自己能看到，且只在其他狼还活着时列出。
function wolfTeam(state, self) {
  return state.seats
    .filter((seat) => isWolf(seat.role))
    .map((seat) => ({ id: seat.id, seat: seat.seat, username: seat.username, alive: seat.alive, isSelf: seat.id === self.id }));
}

function seerPrivate(state, self) {
  return {
    checks: (state.seerChecks || [])
      .filter((check) => check.seerId === self.id)
      .map((check) => ({ night: check.night, targetId: check.targetId, targetSeat: check.targetSeat, isWolf: check.isWolf }))
  };
}

function witchPrivate(state, self, board) {
  const potions = state.witchPotions || { save: true, poison: true };
  // 解药用完后不再告知刀口（标准规则）。
  const mayKnowKill = potions.save && NIGHT_PHASES.has(state.phase);
  const tonightKill = mayKnowKill ? (state.tonightWolfTarget || null) : null;
  const selfSaveAllowed = witchMaySelfSave(board, state.night);
  return {
    potions,
    tonightKill,
    // 首夜之外不能自救：刀口是自己时不给解药选项。
    mayUseSave: potions.save && Boolean(tonightKill)
      && (tonightKill !== self.id || selfSaveAllowed),
    mayUsePoison: potions.poison
      && (board.witchDoublePotion || !state.pendingWitchSave),
    usedThisNight: state.witchUsedThisNight || null
  };
}

function wolfPrivate(state, self) {
  return {
    team: wolfTeam(state, self),
    // 队友提名实时可见，截止前可改。
    picks: Object.fromEntries(state.wolfPicks || []),
    chat: (state.wolfChat || []).map((line) => ({ from: line.from, seat: line.seat, text: line.text, at: line.at }))
  };
}

// 该 actor 的私密视图。actorId 不在座位上（lobby 候补或旁观者）时只给公开信息，
// 但仍要带 legalActions —— 否则 lobby 阶段没人拿得到「坐下」。
function viewFor(state, actorId, board) {
  const base = channelView(state);
  const legalActions = state.legalActionsFor ? state.legalActionsFor(actorId) : [];
  const self = findSeat(state, actorId);
  if (!self) return { ...base, self: null, spectator: true, legalActions };

  const over = state.phase === PHASES.GAME_OVER;
  const view = {
    ...base,
    spectator: false,
    self: {
      id: self.id,
      seat: self.seat,
      username: self.username,
      role: self.role,
      alive: self.alive,
      // 死者能看到自己的死因，别人看不到。
      deathCause: self.deathCause,
      deathNight: self.deathNight
    },
    // host 校验的权威来源仍是 host 自己；这里只是给 UI 和 Agent 的提示。
    legalActions
  };

  // 死者进入观战：公开日志 + 自己的身份，不给上帝视角。
  // 同处一室的死者若能看到全部身份会通过场外渠道泄露；
  // 且保持「任何人只能看到自己该看到的」这个单一不变量，没有例外分支就没有漏洞。
  if (!self.alive && !over) return view;

  if (isWolf(self.role)) view.wolf = wolfPrivate(state, self);
  if (self.role === ROLES.SEER) view.seer = seerPrivate(state, self);
  if (self.role === ROLES.WITCH) view.witch = witchPrivate(state, self, board);
  if (self.role === ROLES.HUNTER) {
    view.hunter = { mayShoot: state.pendingHunter === self.id };
  }
  return view;
}

module.exports = { viewFor, channelView, publicSeat, revealedSeat, publicPhase, findSeat };
