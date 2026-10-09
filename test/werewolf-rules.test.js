'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { STD9, ROLES, DEATH, CAMP, getBoard, roleCount, canHunterShoot, hasLastWords, witchMaySelfSave } = require('../plays/werewolf/rules/boards');
const { deal, shuffle, mulberry32, seedFrom } = require('../plays/werewolf/rules/deal');
const { checkVictory, REASON } = require('../plays/werewolf/rules/victory');
const { tallyWolfPicks, resolveNight, resolveHunterShot, resolveExile } = require('../plays/werewolf/rules/resolve');
const { resolveVote, resolvePkVote, pkVoters } = require('../plays/werewolf/rules/ballot');
const { PHASES } = require('../plays/werewolf/rules/phases');
const { viewFor, channelView } = require('../plays/werewolf/visibility');

function seats(spec) {
  return spec.map((role, index) => ({
    id: `u${index + 1}`, username: `P${index + 1}`, kind: 'human',
    seat: index + 1, role, alive: true, deathCause: null, deathNight: 0
  }));
}

const STD9_SPEC = [
  ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.WEREWOLF,
  ROLES.SEER, ROLES.WITCH, ROLES.HUNTER,
  ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER
];

function baseState(overrides = {}) {
  return {
    gameId: 'g_test', boardId: 'std9', phase: PHASES.DAY_SPEECH, night: 1, day: 1,
    deadline: 0, currentSpeaker: null, seats: seats(STD9_SPEC), publicLog: [],
    wolfPicks: new Map(), wolfChat: [], seerChecks: [],
    witchPotions: { save: true, poison: true }, tonightWolfTarget: null,
    pendingHunter: null, ...overrides
  };
}

// ---------------------------------------------------------------- 板子

test('std9 board is 3 gods + 3 villagers + 3 wolves', () => {
  assert.equal(roleCount(STD9), 9);
  assert.equal(STD9.seats, 9);
  assert.equal(STD9.roles.werewolf, 3);
  assert.equal(STD9.roles.villager, 3);
  assert.equal(STD9.roles.seer + STD9.roles.witch + STD9.roles.hunter, 3);
  assert.equal(getBoard('std9').id, 'std9');
  assert.equal(getBoard('nope'), null);
});

test('hunter may shoot on wolf kill and exile but never on poison', () => {
  assert.equal(canHunterShoot(STD9, DEATH.WOLF), true);
  assert.equal(canHunterShoot(STD9, DEATH.EXILE), true);
  assert.equal(canHunterShoot(STD9, DEATH.POISON), false);
});

test('last words only on the first night, witch self-save only on night 1', () => {
  assert.equal(hasLastWords(STD9, 1), true);
  assert.equal(hasLastWords(STD9, 2), false);
  assert.equal(witchMaySelfSave(STD9, 1), true);
  assert.equal(witchMaySelfSave(STD9, 2), false);
  assert.equal(witchMaySelfSave({ ...STD9, witchSelfSaveNight: 0 }, 1), false);
});

// ---------------------------------------------------------------- 发牌

test('deal produces exactly the board composition and is seed-reproducible', () => {
  const players = Array.from({ length: 9 }, (_, index) => ({ id: `u${index + 1}`, username: `P${index + 1}`, kind: 'human' }));
  const first = deal(STD9, players, 'seed-a');
  const again = deal(STD9, players, 'seed-a');
  const other = deal(STD9, players, 'seed-b');

  const counts = {};
  for (const seat of first) counts[seat.role] = (counts[seat.role] || 0) + 1;
  assert.deepEqual(counts, { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 });
  assert.deepEqual(first.map((seat) => seat.role), again.map((seat) => seat.role), '同一 seed 必须复现同一副牌');
  assert.notDeepEqual(first.map((seat) => seat.role), other.map((seat) => seat.role));
  assert.deepEqual(first.map((seat) => seat.seat), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(first.every((seat) => seat.alive));
});

test('deal rejects a seat count that does not match the board', () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ id: `u${index}`, username: `P${index}`, kind: 'human' }));
  assert.throws(() => deal(STD9, players, 'seed'), /needs 9 seats/);
});

test('shuffle is a permutation, not a resample', () => {
  const next = mulberry32(seedFrom('x'));
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const out = shuffle(input, next);
  assert.deepEqual([...out].sort((a, b) => a - b), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'shuffle 不得改动入参');
});

// ---------------------------------------------------------------- 胜负

test('good wins when every wolf is dead', () => {
  const board = STD9;
  const state = seats(STD9_SPEC).map((seat) => (seat.role === ROLES.WEREWOLF ? { ...seat, alive: false } : seat));
  assert.deepEqual(checkVictory(state, board), { over: true, winner: CAMP.GOOD, reason: REASON.ALL_WOLVES_DEAD });
});

test('edge victory: wiping all gods or all villagers wins for wolves', () => {
  const godsGone = seats(STD9_SPEC).map((seat) => ([ROLES.SEER, ROLES.WITCH, ROLES.HUNTER].includes(seat.role) ? { ...seat, alive: false } : seat));
  assert.equal(checkVictory(godsGone, STD9).reason, REASON.GODS_WIPED);

  const villagersGone = seats(STD9_SPEC).map((seat) => (seat.role === ROLES.VILLAGER ? { ...seat, alive: false } : seat));
  assert.equal(checkVictory(villagersGone, STD9).reason, REASON.VILLAGERS_WIPED);
});

test('town victory mode does not end when only the gods are gone', () => {
  const board = { ...STD9, victory: 'town' };
  // 3 狼 + 3 民存活，神全灭：屠边判狼胜，屠城因狼数≥好人数也判狼胜。
  const godsGone = seats(STD9_SPEC).map((seat) => ([ROLES.SEER, ROLES.WITCH, ROLES.HUNTER].includes(seat.role) ? { ...seat, alive: false } : seat));
  assert.equal(checkVictory(godsGone, board).reason, REASON.UNSTOPPABLE);

  // 1 狼(u1) vs 2 神(u4,u5)，平民已全灭：
  // 屠边 → 狼胜（民全灭）；屠城 → 好人还剩 2 人且狼数不足，继续。
  const alive = new Set(['u1', 'u4', 'u5']);
  const late = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  assert.equal(checkVictory(late, board).over, false, '屠城：好人未被杀光则继续');
  assert.equal(checkVictory(late, STD9).reason, REASON.VILLAGERS_WIPED, '同一局面屠边已是狼胜');
});

test('wolves win early once they are no longer outnumbered', () => {
  const alive = new Set(['u1', 'u2', 'u4', 'u7']); // 2 狼 vs 1 神 + 1 民
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  assert.deepEqual(checkVictory(state, STD9), { over: true, winner: CAMP.WOLF, reason: REASON.UNSTOPPABLE });
});

test('the last wolf dying alongside the last villager is a good win', () => {
  // 狼全灭优先于屠边判定：同归于尽时好人胜。
  const alive = new Set(['u4']);
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  assert.equal(checkVictory(state, STD9).winner, CAMP.GOOD);
});

// ---------------------------------------------------------------- 狼刀提名

test('wolf picks resolve by majority, ties and empty both mean no kill', () => {
  assert.equal(tallyWolfPicks(new Map([['w1', 'u7'], ['w2', 'u7'], ['w3', 'u8']])).target, 'u7');

  const tie = tallyWolfPicks(new Map([['w1', 'u7'], ['w2', 'u8'], ['w3', 'u9']]));
  assert.equal(tie.target, null);
  assert.equal(tie.tie, true, '三方平票视为空刀');

  assert.equal(tallyWolfPicks(new Map([['w1', null], ['w2', null]])).target, null, '明确空刀');
  assert.equal(tallyWolfPicks(new Map()).target, null, '无人提名');
});

// ---------------------------------------------------------------- 夜间结算

test('witch save cancels the wolf kill, leaving a peaceful night', () => {
  const result = resolveNight(seats(STD9_SPEC), STD9, { wolfTarget: 'u7', witchSave: 'u7', night: 1 });
  assert.deepEqual(result.deaths, []);
  assert.ok(result.seats.every((seat) => seat.alive));
});

test('wolf kill and witch poison can both land in one night', () => {
  const result = resolveNight(seats(STD9_SPEC), STD9, { wolfTarget: 'u7', witchPoison: 'u1', night: 2 });
  assert.deepEqual(result.deaths.map((seat) => seat.id).sort(), ['u1', 'u7']);
  assert.equal(result.seats.find((seat) => seat.id === 'u7').deathCause, DEATH.WOLF);
  assert.equal(result.seats.find((seat) => seat.id === 'u1').deathCause, DEATH.POISON);
});

test('a hunter killed by wolves may shoot, a poisoned hunter may not', () => {
  const shot = resolveNight(seats(STD9_SPEC), STD9, { wolfTarget: 'u6', night: 1 });
  assert.equal(shot.pendingHunter, 'u6');

  const poisoned = resolveNight(seats(STD9_SPEC), STD9, { witchPoison: 'u6', night: 2 });
  assert.equal(poisoned.pendingHunter, null, '被毒杀的猎人不能开枪');
});

// 「狼刀在先」：这是最容易判错的一条规则。
test('wolf-kill-first: a poisoned last wolf does not undo a wolf victory', () => {
  // 1 狼(u1) + 1 女巫(u5) + 1 民(u7) 存活，屠边。狼刀 u7 → 民全灭 → 狼胜。
  // 女巫同夜毒死最后一只狼也无效。
  const alive = new Set(['u1', 'u5', 'u7']);
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  const result = resolveNight(state, STD9, { wolfTarget: 'u7', witchPoison: 'u1', night: 3 });

  assert.equal(result.victory.over, true);
  assert.equal(result.victory.winner, CAMP.WOLF, '狼刀在先：先达成的狼胜不被后续毒杀推翻');
  assert.equal(result.victory.reason, REASON.VILLAGERS_WIPED);
  assert.deepEqual(result.deaths.map((seat) => seat.id), ['u7'], '胜负已定后不再结算毒药');
  assert.equal(result.seats.find((seat) => seat.id === 'u1').alive, true);
});

test('a poisoned last wolf is a good win when no wolf victory happened first', () => {
  // 1 狼(u1) + 神(u5) + 2 民(u7,u8)：狼空刀，女巫毒死最后一只狼 → 好人胜。
  const alive = new Set(['u1', 'u5', 'u7', 'u8']);
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  const result = resolveNight(state, STD9, { wolfTarget: null, witchPoison: 'u1', night: 3 });
  assert.equal(result.victory.winner, CAMP.GOOD);
  assert.equal(result.victory.reason, REASON.ALL_WOLVES_DEAD);
});

test('exile and hunter shot resolve and re-check victory', () => {
  const exiled = resolveExile(seats(STD9_SPEC), STD9, 'u6', 1);
  assert.equal(exiled.seats.find((seat) => seat.id === 'u6').deathCause, DEATH.EXILE);
  assert.equal(exiled.pendingHunter, 'u6', '被放逐的猎人可以开枪');

  const shot = resolveHunterShot(exiled.seats, STD9, 'u6', 'u1', 1);
  assert.equal(shot.seats.find((seat) => seat.id === 'u1').alive, false);
  assert.equal(shot.deaths[0].deathCause, DEATH.HUNTER);

  const passed = resolveHunterShot(exiled.seats, STD9, 'u6', null, 1);
  assert.deepEqual(passed.deaths, [], '弃枪不产生死亡');
});

test('resolvers never mutate the seats they are given', () => {
  const original = seats(STD9_SPEC);
  const snapshot = JSON.stringify(original);
  resolveNight(original, STD9, { wolfTarget: 'u7', witchPoison: 'u1', night: 1 });
  resolveExile(original, STD9, 'u2', 1);
  resolveHunterShot(original, STD9, 'u6', 'u1', 1);
  assert.equal(JSON.stringify(original), snapshot);
});

// ---------------------------------------------------------------- 投票

test('a clear majority exiles, and the tally is public', () => {
  const result = resolveVote(new Map([['u1', 'u7'], ['u2', 'u7'], ['u3', 'u8'], ['u4', null]]));
  assert.equal(result.outcome, 'exile');
  assert.equal(result.exiled, 'u7');
  assert.equal(result.abstain, 1);
  assert.deepEqual(result.detail.get('u7'), ['u1', 'u2'], '唱票公开：谁投了谁');
});

test('a tie goes to PK, and everyone abstaining exiles nobody', () => {
  const tied = resolveVote(new Map([['u1', 'u7'], ['u2', 'u8']]));
  assert.equal(tied.outcome, 'tie');
  assert.deepEqual(tied.tied.sort(), ['u7', 'u8']);

  const allAbstain = resolveVote(new Map([['u1', null], ['u2', null]]));
  assert.equal(allAbstain.outcome, 'none');
  assert.equal(allAbstain.exiled, null);
});

test('PK excludes the tied players from voting', () => {
  const alive = new Set(['u1', 'u2', 'u7', 'u8']);
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  assert.deepEqual(pkVoters(state, ['u7', 'u8']).sort(), ['u1', 'u2']);
});

// 边界：三方平票会让 PK 无人可投，不守住就会卡死在 pk_vote。
test('a three-way tie among the last three players exiles nobody instead of deadlocking', () => {
  const alive = new Set(['u1', 'u4', 'u7']);
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  const tied = ['u1', 'u4', 'u7'];
  assert.deepEqual(pkVoters(state, tied), [], '平票者全是存活者时无人可投');

  const result = resolvePkVote(new Map(), state, tied);
  assert.equal(result.outcome, 'none');
  assert.equal(result.exiled, null);
});

test('a second tie in PK exiles nobody rather than looping forever', () => {
  const alive = new Set(['u1', 'u2', 'u7', 'u8']);
  const state = seats(STD9_SPEC).map((seat) => ({ ...seat, alive: alive.has(seat.id) }));
  const result = resolvePkVote(new Map([['u1', 'u7'], ['u2', 'u8']]), state, ['u7', 'u8']);
  assert.equal(result.outcome, 'none');
});

// ---------------------------------------------------------------- 可见性（泄底）

test('the channel view never carries a role before the game ends', () => {
  const state = baseState({ seerChecks: [{ seerId: 'u4', night: 1, targetId: 'u1', targetSeat: 1, isWolf: true }] });
  const view = channelView(state);
  const text = JSON.stringify(view);
  assert.ok(!text.includes('werewolf'), '频道快照不得含 role');
  assert.ok(!text.includes('"seer"'));
  assert.ok(view.seats.every((seat) => !Object.hasOwn(seat, 'role')));
  assert.ok(!text.includes('seerChecks'));
});

test('wolves see their team, nobody else does', () => {
  const state = baseState();
  const wolf = viewFor(state, 'u1', STD9);
  assert.deepEqual(wolf.wolf.team.map((mate) => mate.id).sort(), ['u1', 'u2', 'u3']);

  // 座位名单本身是公开的（要画出玩家列表），泄底与否看的是能不能区分出狼。
  for (const outsider of ['u4', 'u5', 'u6', 'u7']) {
    const view = viewFor(state, outsider, STD9);
    assert.equal(view.wolf, undefined, `${outsider} 不得看到狼队`);
    const text = JSON.stringify(view);
    assert.ok(!text.includes('werewolf'), `${outsider} 的视图不得出现狼身份`);
    assert.ok(!text.includes('wolfChat') && !text.includes('picks'));
  }
});

test('seer checks stay with the seer', () => {
  const state = baseState({ seerChecks: [{ seerId: 'u4', night: 1, targetId: 'u1', targetSeat: 1, isWolf: true }] });
  assert.deepEqual(viewFor(state, 'u4', STD9).seer.checks, [{ night: 1, targetId: 'u1', targetSeat: 1, isWolf: true }]);
  for (const outsider of ['u1', 'u5', 'u6', 'u7']) {
    assert.equal(viewFor(state, outsider, STD9).seer, undefined);
    assert.ok(!JSON.stringify(viewFor(state, outsider, STD9)).includes('isWolf'));
  }
});

test("tonight's kill is visible to the witch only, and only while she holds the antidote", () => {
  const state = baseState({ phase: PHASES.NIGHT_WITCH, tonightWolfTarget: 'u7' });
  assert.equal(viewFor(state, 'u5', STD9).witch.tonightKill, 'u7');
  for (const outsider of ['u1', 'u4', 'u6', 'u7']) {
    const text = JSON.stringify(viewFor(state, outsider, STD9));
    assert.ok(!text.includes('tonightKill'), `${outsider} 不得看到刀口`);
  }

  // 解药用完后不再告知刀口。
  const spent = baseState({ phase: PHASES.NIGHT_WITCH, tonightWolfTarget: 'u7', witchPotions: { save: false, poison: true } });
  assert.equal(viewFor(spent, 'u5', STD9).witch.tonightKill, null);
});

test('the witch may only self-save on night 1', () => {
  const night1 = baseState({ phase: PHASES.NIGHT_WITCH, night: 1, tonightWolfTarget: 'u5' });
  assert.equal(viewFor(night1, 'u5', STD9).witch.mayUseSave, true);

  const night2 = baseState({ phase: PHASES.NIGHT_WITCH, night: 2, tonightWolfTarget: 'u5' });
  assert.equal(viewFor(night2, 'u5', STD9).witch.mayUseSave, false, '第二夜起不能自救');

  const other = baseState({ phase: PHASES.NIGHT_WITCH, night: 2, tonightWolfTarget: 'u7' });
  assert.equal(viewFor(other, 'u5', STD9).witch.mayUseSave, true, '救别人不受限制');
});

test('a dead player becomes a spectator without gaining omniscience', () => {
  const state = baseState({ seats: seats(STD9_SPEC).map((seat) => (seat.id === 'u7' ? { ...seat, alive: false, deathCause: DEATH.WOLF, deathNight: 1 } : seat)) });
  const view = viewFor(state, 'u7', STD9);
  assert.equal(view.self.role, ROLES.VILLAGER, '死者仍看得到自己的身份');
  assert.equal(view.self.deathCause, DEATH.WOLF);
  assert.ok(view.seats.every((seat) => !Object.hasOwn(seat, 'role')), '死者不得看到他人身份');
  assert.equal(view.wolf, undefined);
  assert.equal(view.seer, undefined);
});

test('a dead wolf loses the team channel', () => {
  const state = baseState({
    seats: seats(STD9_SPEC).map((seat) => (seat.id === 'u1' ? { ...seat, alive: false } : seat)),
    wolfChat: [{ from: 'u2', seat: 2, text: '刀 7 号', at: 1 }]
  });
  const text = JSON.stringify(viewFor(state, 'u1', STD9));
  assert.ok(!text.includes('刀 7 号'), '死狼不再收到狼队私聊');
});

test('game over reveals every role to everyone', () => {
  const state = baseState({ phase: PHASES.GAME_OVER, result: { winner: CAMP.GOOD, reason: REASON.ALL_WOLVES_DEAD } });
  const view = channelView(state);
  assert.ok(view.seats.every((seat) => typeof seat.role === 'string'));
  assert.equal(view.result.winner, CAMP.GOOD);
});

test('a non-player gets the public view only', () => {
  const view = viewFor(baseState(), 'stranger', STD9);
  assert.equal(view.spectator, true);
  assert.equal(view.self, null);
  assert.ok(view.seats.every((seat) => !Object.hasOwn(seat, 'role')));
});

// 全角色扫描：任何人的私密视图都不得含他人身份。
test('no private view leaks another player role', () => {
  const state = baseState({
    phase: PHASES.NIGHT_WITCH,
    tonightWolfTarget: 'u7',
    wolfPicks: new Map([['u1', 'u7'], ['u2', 'u7']]),
    wolfChat: [{ from: 'u1', seat: 1, text: '刀 7', at: 1 }],
    seerChecks: [{ seerId: 'u4', night: 1, targetId: 'u1', targetSeat: 1, isWolf: true }]
  });
  for (const seat of state.seats) {
    const view = viewFor(state, seat.id, STD9);
    for (const other of state.seats) {
      if (other.id === seat.id) continue;
      const exposed = view.seats.find((entry) => entry.id === other.id);
      assert.ok(!Object.hasOwn(exposed, 'role'), `${seat.id} 的视图暴露了 ${other.id} 的身份`);
    }
  }
});
