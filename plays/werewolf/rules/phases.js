'use strict';

// 阶段常量与元数据。machine.js（P1）消费 TIMER_KEY 与 SPEECH_PHASES。
const PHASES = Object.freeze({
  LOBBY: 'lobby',
  DEALING: 'dealing',
  NIGHT_ACTIONS: 'night_actions',
  NIGHT_WITCH: 'night_witch',
  DAWN: 'dawn',
  LAST_WORDS: 'last_words',
  HUNTER_SHOT: 'hunter_shot',
  DAY_SPEECH: 'day_speech',
  DAY_VOTE: 'day_vote',
  VOTE_RESULT: 'vote_result',
  PK_SPEECH: 'pk_speech',
  PK_VOTE: 'pk_vote',
  EXILE_LAST_WORDS: 'exile_last_words',
  GAME_OVER: 'game_over'
});

// 阶段 → board.timers 的键。缺失表示该阶段没有超时（lobby / game_over）。
const TIMER_KEY = Object.freeze({
  [PHASES.NIGHT_ACTIONS]: 'nightActions',
  [PHASES.NIGHT_WITCH]: 'nightWitch',
  [PHASES.DAWN]: 'dawn',
  [PHASES.LAST_WORDS]: 'lastWords',
  [PHASES.HUNTER_SHOT]: 'hunterShot',
  [PHASES.DAY_SPEECH]: 'daySpeech',
  [PHASES.DAY_VOTE]: 'dayVote',
  [PHASES.VOTE_RESULT]: 'voteResult',
  [PHASES.PK_SPEECH]: 'pkSpeech',
  [PHASES.PK_VOTE]: 'pkVote',
  [PHASES.EXILE_LAST_WORDS]: 'exileLastWords'
});

// 允许 speak / endSpeech 的阶段。只有 phase.currentSpeaker 本人能发。
const SPEECH_PHASES = Object.freeze(new Set([
  PHASES.LAST_WORDS, PHASES.DAY_SPEECH, PHASES.PK_SPEECH, PHASES.EXILE_LAST_WORDS
]));

// 夜晚阶段：玩法页在这些阶段一律不发 typing，否则会泄露谁在行动。
const NIGHT_PHASES = Object.freeze(new Set([PHASES.NIGHT_ACTIONS, PHASES.NIGHT_WITCH]));

const VOTE_PHASES = Object.freeze(new Set([PHASES.DAY_VOTE, PHASES.PK_VOTE]));

function timerMsFor(board, phaseName) {
  const key = TIMER_KEY[phaseName];
  return key ? board.timers[key] : 0;
}

module.exports = { PHASES, TIMER_KEY, SPEECH_PHASES, NIGHT_PHASES, VOTE_PHASES, timerMsFor };
