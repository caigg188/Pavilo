'use strict';

const { getBoard, ROLES, isWolf, hasLastWords, witchMaySelfSave, CAMP } = require('./rules/boards');
const { PHASES, SPEECH_PHASES, timerMsFor } = require('./rules/phases');
const { deal, firstSpeakerIndex } = require('./rules/deal');
const { tallyWolfPicks, resolveNight, resolveHunterShot, resolveExile, seatById } = require('./rules/resolve');
const { resolveVote, resolvePkVote, pkVoters } = require('./rules/ballot');
const { viewFor } = require('./visibility');

const ERR = Object.freeze({
  PHASE: 'WW_WRONG_PHASE',
  NOT_SEATED: 'WW_NOT_SEATED',
  DEAD: 'WW_DEAD_CANNOT_ACT',
  NOT_YOUR_TURN: 'WW_NOT_YOUR_TURN',
  ROLE: 'WW_WRONG_ROLE',
  TARGET: 'WW_INVALID_TARGET',
  ALREADY: 'WW_ALREADY_SUBMITTED',
  FULL: 'WW_TABLE_FULL',
  NOT_READY: 'WW_NOT_READY',
  POTION: 'WW_POTION_UNAVAILABLE'
});

function reject(code, message) { return { ok: false, code, message: message || code }; }
const OK = (extra = {}) => ({ ok: true, ...extra });

// 阶段状态机。时钟与调度注入，不直接使用 Date.now / setTimeout。
//
// 没有 runtime.cancel（契约未注入），因此用代际计数：每次进入阶段
// generation 自增，旧定时器回调自检后作废。全员提前行动完即可推进，
// 不必空等 deadline。
function createMachine(options = {}) {
  const now = options.now || Date.now;
  const schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
  const randomId = options.randomId || ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`);
  const onChange = options.onChange || (() => {});
  const seatLimit = options.seatLimit || 9;

  let board = getBoard(options.boardId || 'std9');
  let generation = 0;
  let state = freshState();

  function freshState() {
    return {
      phase: PHASES.LOBBY,
      night: 0,
      day: 0,
      deadline: 0,
      seats: [],
      lobby: [],
      publicLog: [],
      currentSpeaker: null,
      speechQueue: [],
      lastWordsQueue: [],
      pendingHunter: null,
      wolfPicks: new Map(),
      wolfChat: [],
      seerChecks: [],
      seerDone: false,
      witchPotions: { save: true, poison: true },
      witchDone: false,
      pendingWitchSave: null,
      tonightWolfTarget: null,
      votes: new Map(),
      voteRound: null,
      pkTied: [],
      speakerRotation: 0,
      result: null,
      gameId: null
    };
  }

  function log(entry) {
    state.publicLog = [...state.publicLog, { at: now(), ...entry }];
  }

  function alive() { return state.seats.filter((seat) => seat.alive); }
  function aliveWolves() { return alive().filter((seat) => isWolf(seat.role)); }
  function seatOf(actorId) { return seatById(state.seats, actorId); }
  function roleSeat(role) { return state.seats.find((seat) => seat.role === role) || null; }

  // ---------------------------------------------------------------- 阶段推进

  function enterPhase(name, extra = {}) {
    const mine = ++generation;
    state.phase = name;
    Object.assign(state, extra);
    const ms = timerMsFor(board, name);
    state.deadline = ms ? now() + ms : 0;
    if (ms) {
      schedule(() => {
        // 阶段已经推进过：这次回调属于上一代，直接作废。
        if (mine !== generation) return;
        onDeadline(name);
      }, ms);
    }
    onChange({ phase: name });
    nudgeAgents();
  }

  // 每次进入新阶段，把此刻有合法动作的 Agent 座位唤醒一次。
  // 宿主负责真正的模型调用；machine 只说「轮到你了，这些是你能做的」。
  function nudgeAgents() {
    if (typeof options.requestTurn !== 'function') return;
    if (state.phase === PHASES.LOBBY || state.phase === PHASES.GAME_OVER) return;
    for (const seat of state.seats) {
      if (seat.kind !== 'agent') continue;
      const legalActions = legalActionsFor(seat.id);
      if (!legalActions.length) continue;
      options.requestTurn(
        { id: seat.id, username: seat.username, kind: 'agent' },
        { legalActions, role: seat.role }
      );
    }
  }

  function finish(victory) {
    state.result = { winner: victory.winner, reason: victory.reason };
    log({ kind: 'gameOver', winner: victory.winner, reason: victory.reason });
    enterPhase(PHASES.GAME_OVER);
  }

  // 每次死亡结算后都要走这里：先判胜负，再决定遗言 / 开枪 / 继续。
  function afterDeaths(victory, deaths, next) {
    if (victory.over) { finish(victory); return; }
    const withLastWords = hasLastWords(board, state.night)
      ? deaths.map((seat) => seat.id)
      : [];
    state.lastWordsQueue = withLastWords;
    if (withLastWords.length) { startLastWords(PHASES.LAST_WORDS, next); return; }
    if (state.pendingHunter) { enterPhase(PHASES.HUNTER_SHOT); return; }
    next();
  }

  let afterSpeechHook = null;

  function startLastWords(phaseName, next) {
    afterSpeechHook = next;
    const speaker = state.lastWordsQueue[0] || null;
    if (!speaker) { afterLastWords(); return; }
    enterPhase(phaseName, { currentSpeaker: speaker });
  }

  function afterLastWords() {
    if (state.pendingHunter) { enterPhase(PHASES.HUNTER_SHOT); return; }
    const next = afterSpeechHook;
    afterSpeechHook = null;
    if (next) next();
  }

  function nextLastWordsSpeaker() {
    state.lastWordsQueue = state.lastWordsQueue.slice(1);
    if (state.lastWordsQueue.length) {
      enterPhase(state.phase, { currentSpeaker: state.lastWordsQueue[0] });
      return;
    }
    state.currentSpeaker = null;
    afterLastWords();
  }

  // ---------------------------------------------------------------- 夜晚

  function startNight() {
    state.night += 1;
    state.wolfPicks = new Map();
    state.wolfChat = [];
    state.seerDone = false;
    state.witchDone = false;
    state.pendingWitchSave = null;
    state.tonightWolfTarget = null;
    state.pendingHunter = null;
    log({ kind: 'nightFell', night: state.night });
    enterPhase(PHASES.NIGHT_ACTIONS, { currentSpeaker: null });
  }

  function nightActionsComplete() {
    const wolves = aliveWolves();
    const wolvesDone = wolves.every((seat) => state.wolfPicks.has(seat.id));
    const seer = roleSeat(ROLES.SEER);
    const seerDone = !seer || !seer.alive || state.seerDone;
    return wolvesDone && seerDone;
  }

  function toWitchPhase() {
    state.tonightWolfTarget = tallyWolfPicks(state.wolfPicks).target;
    // 女巫已死或无药时仍然走满这一阶段：提前结束会泄露「场上没有女巫了」。
    // 与线下法官「台词照讲」是同一个理由。
    enterPhase(PHASES.NIGHT_WITCH);
  }

  function toDawn() {
    const witchSave = state.pendingWitchSave;
    const witchPoison = state.witchPoisonTarget || null;
    const resolved = resolveNight(state.seats, board, {
      wolfTarget: state.tonightWolfTarget,
      witchSave,
      witchPoison,
      night: state.night
    });
    state.seats = resolved.seats;
    state.pendingHunter = resolved.pendingHunter;
    state.witchPoisonTarget = null;
    const deaths = resolved.deaths;
    // 只公布谁死了，不公布死因 —— 被毒会暴露女巫已用毒。
    log({ kind: 'dawn', night: state.night, deaths: deaths.map((seat) => seat.seat) });
    enterPhase(PHASES.DAWN);
    state.pendingDeaths = deaths;
    state.pendingVictory = resolved.victory;
  }

  function leaveDawn() {
    const deaths = state.pendingDeaths || [];
    const victory = state.pendingVictory || { over: false };
    state.pendingDeaths = null;
    state.pendingVictory = null;
    afterDeaths(victory, deaths, startDay);
  }

  // ---------------------------------------------------------------- 白天

  function startDay() {
    state.day += 1;
    const living = alive();
    if (!living.length) { finish({ winner: CAMP.WOLF, reason: 'TOWN_WIPED' }); return; }
    // 起始发言位每天顺延，等价于线下「死左/死右」轮换。
    const start = (state.speakerRotation + state.day - 1) % living.length;
    state.speechQueue = [...living.slice(start), ...living.slice(0, start)].map((seat) => seat.id);
    log({ kind: 'dayBegan', day: state.day });
    enterPhase(PHASES.DAY_SPEECH, { currentSpeaker: state.speechQueue[0] });
  }

  function nextSpeaker() {
    state.speechQueue = state.speechQueue.slice(1);
    // 发言者中途死亡不会发生（白天无人死），但掉队的座位要跳过。
    while (state.speechQueue.length && !seatOf(state.speechQueue[0])?.alive) {
      state.speechQueue = state.speechQueue.slice(1);
    }
    if (state.speechQueue.length) {
      enterPhase(state.phase, { currentSpeaker: state.speechQueue[0] });
      return;
    }
    state.currentSpeaker = null;
    if (state.phase === PHASES.PK_SPEECH) startVote(PHASES.PK_VOTE);
    else startVote(PHASES.DAY_VOTE);
  }

  // 遗言与普通发言的轮转规则不同，交棒统一走这里。
  function nextSpeakerFor(phaseName) {
    if (phaseName === PHASES.LAST_WORDS || phaseName === PHASES.EXILE_LAST_WORDS) nextLastWordsSpeaker();
    else nextSpeaker();
  }

  function startVote(phaseName) {    state.votes = new Map();
    enterPhase(phaseName, { currentSpeaker: null });
  }

  function voteEligible() {
    return state.phase === PHASES.PK_VOTE
      ? pkVoters(state.seats, state.pkTied)
      : alive().map((seat) => seat.id);
  }

  function closeVote() {
    const isPk = state.phase === PHASES.PK_VOTE;
    // 超时未投 = 弃票。补齐缺席者，否则唱票会显示「0 弃票」，
    // 看上去像没人参与投票。
    const ballots = new Map(state.votes);
    for (const voterId of voteEligible()) {
      if (!ballots.has(voterId)) ballots.set(voterId, null);
    }
    const outcome = isPk
      ? resolvePkVote(ballots, state.seats, state.pkTied)
      : resolveVote(ballots);
    state.voteRound = {
      phase: state.phase,
      detail: Object.fromEntries([...outcome.detail].map(([target, voters]) => [target, voters])),
      abstain: outcome.abstain,
      outcome: outcome.outcome,
      exiled: outcome.exiled || null,
      tied: outcome.tied || []
    };
    log({ kind: 'voteResult', outcome: outcome.outcome, exiled: outcome.exiled || null, tied: outcome.tied || [] });
    enterPhase(PHASES.VOTE_RESULT);
  }

  function leaveVoteResult() {
    const round = state.voteRound;
    if (!round) { startNight(); return; }
    if (round.outcome === 'tie') {
      state.pkTied = round.tied;
      state.speechQueue = [...round.tied];
      enterPhase(PHASES.PK_SPEECH, { currentSpeaker: state.speechQueue[0] });
      return;
    }
    if (round.outcome !== 'exile' || !round.exiled) { startNight(); return; }
    const resolved = resolveExile(state.seats, board, round.exiled, state.night);
    state.seats = resolved.seats;
    state.pendingHunter = resolved.pendingHunter;
    if (resolved.victory.over) { finish(resolved.victory); return; }
    // 被放逐者始终有遗言，与夜间死亡的 lastWordsNights 无关。
    state.lastWordsQueue = [round.exiled];
    startLastWords(PHASES.EXILE_LAST_WORDS, startNight);
  }

  // ---------------------------------------------------------------- 超时

  function onDeadline(phaseName) {
    switch (phaseName) {
      case PHASES.NIGHT_ACTIONS: toWitchPhase(); return;
      case PHASES.NIGHT_WITCH: toDawn(); return;
      case PHASES.DAWN: leaveDawn(); return;
      case PHASES.LAST_WORDS:
      case PHASES.EXILE_LAST_WORDS: nextLastWordsSpeaker(); return;
      case PHASES.HUNTER_SHOT: resolveHunter(null); return;   // 超时视为弃枪
      case PHASES.DAY_SPEECH:
      case PHASES.PK_SPEECH: nextSpeaker(); return;
      case PHASES.DAY_VOTE:
      case PHASES.PK_VOTE: closeVote(); return;               // 未投视为弃票
      case PHASES.VOTE_RESULT: leaveVoteResult(); return;
      default:
    }
  }

  function resolveHunter(targetId) {
    const hunterId = state.pendingHunter;
    state.pendingHunter = null;
    if (!hunterId) { continueAfterHunter(); return; }
    const resolved = resolveHunterShot(state.seats, board, hunterId, targetId, state.night);
    state.seats = resolved.seats;
    if (targetId) log({ kind: 'hunterShot', target: seatOf(targetId)?.seat || null });
    if (resolved.victory.over) { finish(resolved.victory); return; }
    continueAfterHunter();
  }

  function continueAfterHunter() {
    const next = afterSpeechHook;
    afterSpeechHook = null;
    if (next) { next(); return; }
    // 夜间开枪后进入白天；白天放逐开枪后进入夜晚。
    if (state.day >= state.night) startNight();
    else startDay();
  }

  // ---------------------------------------------------------------- 动作

  const handlers = {
    sit(actorId, payload) {
      if (state.phase !== PHASES.LOBBY) return reject(ERR.PHASE);
      if (state.lobby.some((entry) => entry.id === actorId)) return OK();
      if (state.lobby.length >= seatLimit) return reject(ERR.FULL, '座位已满。');
      state.lobby = [...state.lobby, {
        id: actorId,
        username: String(payload?.username || '').slice(0, 24) || actorId,
        kind: payload?.kind === 'agent' ? 'agent' : 'human'
      }];
      return OK();
    },
    stand(actorId) {
      if (state.phase !== PHASES.LOBBY) return reject(ERR.PHASE);
      state.lobby = state.lobby.filter((entry) => entry.id !== actorId);
      return OK();
    },
    // 占座由宿主完成（machine 保持纯粹），成功后回填到候补名单。
    addAgent() {
      if (state.phase !== PHASES.LOBBY) return reject(ERR.PHASE);
      if (state.lobby.length >= seatLimit) return reject(ERR.FULL, '座位已满。');
      if (typeof options.seatAgent !== 'function') return reject(ERR.NOT_READY, '这个房间不能添加 AI。');
      const taken = new Set(state.lobby.map((entry) => entry.username));
      let index = 1;
      while (taken.has(`AI-${index}`)) index += 1;
      const seated = options.seatAgent({ username: `AI-${index}` });
      if (!seated || seated.error || !seated.actor) {
        return reject(seated?.error || ERR.FULL, '没能添加 AI。');
      }
      state.lobby = [...state.lobby, {
        id: seated.actor.id,
        username: seated.actor.username,
        kind: 'agent'
      }];
      return OK();
    },
    setBoard(actorId, payload) {
      if (state.phase !== PHASES.LOBBY) return reject(ERR.PHASE);
      const next = getBoard(payload?.boardId);
      if (!next) return reject(ERR.TARGET, '没有这个板子。');
      board = next;
      return OK();
    },
    start() {
      if (state.phase !== PHASES.LOBBY) return reject(ERR.PHASE);
      if (state.lobby.length !== board.seats) {
        return reject(ERR.NOT_READY, `需要 ${board.seats} 人才能开始，现在 ${state.lobby.length} 人。`);
      }
      const gameId = randomId('wwg');
      state.gameId = gameId;
      state.seats = deal(board, state.lobby, gameId);
      state.speakerRotation = firstSpeakerIndex(state.seats, gameId);
      state.night = 0;
      state.day = 0;
      log({ kind: 'started', boardId: board.id, seats: state.seats.length });
      startNight();
      return OK();
    },

    wolfPick(actorId, payload) {
      if (state.phase !== PHASES.NIGHT_ACTIONS) return reject(ERR.PHASE);
      const self = seatOf(actorId);
      if (!self) return reject(ERR.NOT_SEATED);
      if (!self.alive) return reject(ERR.DEAD);
      if (!isWolf(self.role)) return reject(ERR.ROLE);
      const target = payload?.target || null;
      // 允许空刀、允许自刀；截止前可改。
      if (target && !seatOf(target)?.alive) return reject(ERR.TARGET);
      state.wolfPicks = new Map(state.wolfPicks).set(actorId, target);
      if (nightActionsComplete()) toWitchPhase();
      return OK();
    },
    wolfChat(actorId, payload) {
      if (state.phase !== PHASES.NIGHT_ACTIONS) return reject(ERR.PHASE);
      const self = seatOf(actorId);
      if (!self?.alive) return reject(self ? ERR.DEAD : ERR.NOT_SEATED);
      if (!isWolf(self.role)) return reject(ERR.ROLE);
      const text = String(payload?.text || '').trim().slice(0, 200);
      if (!text) return reject(ERR.TARGET, '说点什么。');
      state.wolfChat = [...state.wolfChat, { from: self.id, seat: self.seat, text, at: now() }];
      return OK();
    },
    seerCheck(actorId, payload) {
      if (state.phase !== PHASES.NIGHT_ACTIONS) return reject(ERR.PHASE);
      const self = seatOf(actorId);
      if (!self?.alive) return reject(self ? ERR.DEAD : ERR.NOT_SEATED);
      if (self.role !== ROLES.SEER) return reject(ERR.ROLE);
      if (state.seerDone) return reject(ERR.ALREADY);
      const target = seatOf(payload?.target);
      if (!target || !target.alive || target.id === actorId) return reject(ERR.TARGET);
      state.seerChecks = [...state.seerChecks, {
        seerId: actorId, night: state.night, targetId: target.id, targetSeat: target.seat, isWolf: isWolf(target.role)
      }];
      state.seerDone = true;
      if (nightActionsComplete()) toWitchPhase();
      return OK();
    },

    witchSave(actorId) {
      const guard = witchGuard(actorId);
      if (guard) return guard;
      if (!state.witchPotions.save) return reject(ERR.POTION, '解药已经用过了。');
      const target = state.tonightWolfTarget;
      if (!target) return reject(ERR.TARGET, '今晚没有人被袭击。');
      if (target === actorId && !witchMaySelfSave(board, state.night)) {
        return reject(ERR.TARGET, '现在不能自救。');
      }
      state.witchPotions = { ...state.witchPotions, save: false };
      state.pendingWitchSave = target;
      state.witchDone = true;
      if (!board.witchDoublePotion) { toDawn(); return OK(); }
      return OK();
    },
    witchPoison(actorId, payload) {
      const guard = witchGuard(actorId);
      if (guard) return guard;
      if (!state.witchPotions.poison) return reject(ERR.POTION, '毒药已经用过了。');
      if (!board.witchDoublePotion && state.pendingWitchSave) {
        return reject(ERR.POTION, '同一晚不能同时用解药和毒药。');
      }
      const target = seatOf(payload?.target);
      if (!target || !target.alive) return reject(ERR.TARGET);
      state.witchPotions = { ...state.witchPotions, poison: false };
      state.witchPoisonTarget = target.id;
      state.witchDone = true;
      toDawn();
      return OK();
    },
    witchPass(actorId) {
      const guard = witchGuard(actorId);
      if (guard) return guard;
      state.witchDone = true;
      toDawn();
      return OK();
    },

    speak(actorId, payload) {
      if (!SPEECH_PHASES.has(state.phase)) return reject(ERR.PHASE, '现在不是发言时间。');
      const self = seatOf(actorId);
      if (!self) return reject(ERR.NOT_SEATED);
      // 出局后禁止公开发言，唯一例外是自己的遗言窗口。
      if (!self.alive && state.currentSpeaker !== actorId) return reject(ERR.DEAD, '出局后不能发言。');
      if (state.currentSpeaker !== actorId) return reject(ERR.NOT_YOUR_TURN, '还没轮到你。');
      const text = String(payload?.text || '').trim();
      if (!text) return reject(ERR.TARGET, '说点什么。');
      // 人类一个回合内可以连发多条，说完自己点「结束发言」。
      // Agent 不会主动收尾，讲完一句就把话筒交出去，否则每轮都要空耗满 90 秒。
      state.spokenThisTurn = true;
      if (self.kind === 'agent') nextSpeakerFor(state.phase);
      return OK({ post: { text } });
    },
    endSpeech(actorId) {
      if (!SPEECH_PHASES.has(state.phase)) return reject(ERR.PHASE);
      if (state.currentSpeaker !== actorId) return reject(ERR.NOT_YOUR_TURN);
      nextSpeakerFor(state.phase);
      return OK();
    },

    vote(actorId, payload) {
      if (state.phase !== PHASES.DAY_VOTE && state.phase !== PHASES.PK_VOTE) return reject(ERR.PHASE);
      const self = seatOf(actorId);
      if (!self) return reject(ERR.NOT_SEATED);
      if (!self.alive) return reject(ERR.DEAD, '出局后不能投票。');
      if (!voteEligible().includes(actorId)) return reject(ERR.NOT_YOUR_TURN, '这一轮你不参与投票。');
      if (state.votes.has(actorId)) return reject(ERR.ALREADY);
      const target = seatOf(payload?.target);
      if (!target || !target.alive) return reject(ERR.TARGET);
      state.votes = new Map(state.votes).set(actorId, target.id);
      if (state.votes.size >= voteEligible().length) closeVote();
      return OK();
    },
    abstain(actorId) {
      if (state.phase !== PHASES.DAY_VOTE && state.phase !== PHASES.PK_VOTE) return reject(ERR.PHASE);
      const self = seatOf(actorId);
      if (!self?.alive) return reject(self ? ERR.DEAD : ERR.NOT_SEATED);
      if (!voteEligible().includes(actorId)) return reject(ERR.NOT_YOUR_TURN);
      if (state.votes.has(actorId)) return reject(ERR.ALREADY);
      state.votes = new Map(state.votes).set(actorId, null);
      if (state.votes.size >= voteEligible().length) closeVote();
      return OK();
    },

    hunterShoot(actorId, payload) {
      if (state.phase !== PHASES.HUNTER_SHOT) return reject(ERR.PHASE);
      if (state.pendingHunter !== actorId) return reject(ERR.ROLE);
      const target = seatOf(payload?.target);
      if (!target || !target.alive) return reject(ERR.TARGET);
      resolveHunter(target.id);
      return OK();
    },
    hunterPass(actorId) {
      if (state.phase !== PHASES.HUNTER_SHOT) return reject(ERR.PHASE);
      if (state.pendingHunter !== actorId) return reject(ERR.ROLE);
      resolveHunter(null);
      return OK();
    },

    restart() {
      if (state.phase !== PHASES.GAME_OVER) return reject(ERR.PHASE);
      const seated = state.seats.map((seat) => ({ id: seat.id, username: seat.username, kind: seat.kind }));
      state = freshState();
      state.lobby = seated;
      generation += 1;
      onChange({ phase: PHASES.LOBBY });
      return OK();
    }
  };

  function witchGuard(actorId) {
    if (state.phase !== PHASES.NIGHT_WITCH) return reject(ERR.PHASE);
    const self = seatOf(actorId);
    if (!self) return reject(ERR.NOT_SEATED);
    if (!self.alive) return reject(ERR.DEAD);
    if (self.role !== ROLES.WITCH) return reject(ERR.ROLE);
    if (state.witchDone) return reject(ERR.ALREADY);
    return null;
  }

  // ---------------------------------------------------------------- 合法动作

  // 给 Agent 与 UI 的提示。权威校验仍在上面的 handlers 里，这里只是收窄选项。
  function legalActionsFor(actorId) {
    // lobby 阶段还没发牌，state.seats 是空的，身份要看候补名单。
    if (state.phase === PHASES.LOBBY) {
      const seated = state.lobby.some((entry) => entry.id === actorId);
      if (!seated) return state.lobby.length < seatLimit ? [{ name: 'sit' }, { name: 'addAgent' }] : [];
      const actions = [{ name: 'stand' }];
      if (state.lobby.length < seatLimit) actions.push({ name: 'addAgent' });
      if (state.lobby.length === board.seats) actions.push({ name: 'start' });
      return actions;
    }
    const self = seatOf(actorId);
    if (!self) return [];
    if (!self.alive) {
      return state.currentSpeaker === actorId ? [{ name: 'speak' }, { name: 'endSpeech' }] : [];
    }
    const targets = alive().filter((seat) => seat.id !== actorId).map((seat) => seat.id);
    switch (state.phase) {
      case PHASES.NIGHT_ACTIONS: {
        if (isWolf(self.role)) {
          return [
            ...alive().map((seat) => ({ name: 'wolfPick', payload: { target: seat.id } })),
            { name: 'wolfPick', payload: { target: null } },
            { name: 'wolfChat' }
          ];
        }
        if (self.role === ROLES.SEER && !state.seerDone) {
          return targets.map((id) => ({ name: 'seerCheck', payload: { target: id } }));
        }
        return [];
      }
      case PHASES.NIGHT_WITCH: {
        if (self.role !== ROLES.WITCH || state.witchDone) return [];
        const actions = [{ name: 'witchPass' }];
        const kill = state.tonightWolfTarget;
        if (state.witchPotions.save && kill && (kill !== self.id || witchMaySelfSave(board, state.night))) {
          actions.unshift({ name: 'witchSave' });
        }
        if (state.witchPotions.poison && (board.witchDoublePotion || !state.pendingWitchSave)) {
          for (const id of targets) actions.push({ name: 'witchPoison', payload: { target: id } });
        }
        return actions;
      }
      case PHASES.HUNTER_SHOT:
        if (state.pendingHunter !== actorId) return [];
        return [...targets.map((id) => ({ name: 'hunterShoot', payload: { target: id } })), { name: 'hunterPass' }];
      case PHASES.LAST_WORDS:
      case PHASES.EXILE_LAST_WORDS:
      case PHASES.DAY_SPEECH:
      case PHASES.PK_SPEECH:
        return state.currentSpeaker === actorId ? [{ name: 'speak' }, { name: 'endSpeech' }] : [];
      case PHASES.DAY_VOTE:
      case PHASES.PK_VOTE: {
        if (!voteEligible().includes(actorId) || state.votes.has(actorId)) return [];
        return [...targets.map((id) => ({ name: 'vote', payload: { target: id } })), { name: 'abstain' }];
      }
      case PHASES.GAME_OVER:
        return [{ name: 'restart' }];
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------- 对外

  function dispatch(actorId, action = {}) {
    const handler = handlers[action.name];
    if (!handler) return reject('WW_UNKNOWN_ACTION', '不支持这个动作。');
    return handler(actorId, action.payload || {});
  }

  function snapshot(actorId) {
    return viewFor({ ...state, legalActionsFor }, actorId, board);
  }

  function serialize() {
    return {
      ...state,
      boardId: board.id,
      wolfPicks: [...state.wolfPicks],
      votes: [...state.votes],
      pendingDeaths: null,
      pendingVictory: null
    };
  }

  // 定时器不在存档里：重启后必须重新武装，否则会永远卡在原阶段。
  function hydrate(saved) {
    if (!saved || typeof saved !== 'object') return false;
    const restoredBoard = getBoard(saved.boardId);
    if (!restoredBoard) return false;
    board = restoredBoard;
    state = {
      ...freshState(),
      ...saved,
      wolfPicks: new Map(saved.wolfPicks || []),
      votes: new Map(saved.votes || []),
      pendingDeaths: null,
      pendingVictory: null
    };
    const ms = timerMsFor(board, state.phase);
    if (ms) enterPhase(state.phase, { currentSpeaker: state.currentSpeaker });
    return true;
  }

  return {
    dispatch,
    snapshot,
    legalActionsFor,
    serialize,
    hydrate,
    get phase() { return state.phase; },
    get deadline() { return state.deadline; },
    get board() { return board; },
    get gameId() { return state.gameId; },
    get result() { return state.result; },
    seats: () => state.seats.map((seat) => ({ ...seat })),
    lobby: () => [...state.lobby],
    channelState: () => ({ ...state, legalActionsFor })
  };
}

module.exports = { createMachine, ERR };
