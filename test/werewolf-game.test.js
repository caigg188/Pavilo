'use strict';

// 完整对局走查：用纯函数把一局 9 人局从发牌打到终局。
// 单个规则通过 ≠ 一局能跑通，这里验证的是各环节能否串起来。
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { STD9, ROLES, DEATH, CAMP } = require('../plays/werewolf/rules/boards');
const { deal } = require('../plays/werewolf/rules/deal');
const { tallyWolfPicks, resolveNight, resolveExile, resolveHunterShot } = require('../plays/werewolf/rules/resolve');
const { resolveVote } = require('../plays/werewolf/rules/ballot');
const { checkVictory, REASON } = require('../plays/werewolf/rules/victory');
const { viewFor } = require('../plays/werewolf/visibility');

const PLAYERS = Array.from({ length: 9 }, (_, index) => ({
  id: `u${index + 1}`, username: `P${index + 1}`, kind: index < 3 ? 'human' : 'agent'
}));

function idsOf(seats, role) {
  return seats.filter((seat) => seat.role === role && seat.alive).map((seat) => seat.id);
}

test('a dealt game plays through to a good win with no leaks along the way', () => {
  let seats = deal(STD9, PLAYERS, 'integration-seed');
  let night = 0;
  let guard = 0;

  // 每一步都断言：没有任何人的视图暴露他人身份。
  const assertNoLeak = (state) => {
    for (const seat of state.seats) {
      const view = viewFor(state, seat.id, STD9);
      for (const other of state.seats) {
        if (other.id === seat.id) continue;
        const exposed = view.seats.find((entry) => entry.id === other.id);
        assert.ok(!Object.hasOwn(exposed, 'role'), `${seat.id} 看到了 ${other.id} 的身份`);
      }
    }
  };

  // 好人策略：每天精准投出一只狼（模拟推理成功），直到狼全灭。
  while (guard < 20) {
    guard += 1;
    night += 1;

    // —— 夜晚：狼统一刀一个平民；女巫第一夜救人，之后留药。
    const wolves = idsOf(seats, ROLES.WEREWOLF);
    const victims = seats.filter((seat) => seat.alive && seat.role === ROLES.VILLAGER);
    const picks = new Map(wolves.map((wolf) => [wolf, victims[0]?.id || null]));
    const { target } = tallyWolfPicks(picks);

    const witchAlive = idsOf(seats, ROLES.WITCH).length > 0;
    const save = night === 1 && witchAlive && target ? target : null;
    const resolved = resolveNight(seats, STD9, { wolfTarget: target, witchSave: save, night });
    seats = resolved.seats;

    assertNoLeak({ gameId: 'g', boardId: 'std9', phase: 'dawn', night, day: night,
      seats, publicLog: [], wolfPicks: picks, wolfChat: [], seerChecks: [],
      witchPotions: { save: !save, poison: true } });

    if (resolved.victory.over) { assert.equal(resolved.victory.winner, CAMP.WOLF); return; }

    // 夜里死掉的猎人开枪带走一只狼。
    if (resolved.pendingHunter) {
      const shot = resolveHunterShot(seats, STD9, resolved.pendingHunter, idsOf(seats, ROLES.WEREWOLF)[0], night);
      seats = shot.seats;
      if (shot.victory.over) { assert.equal(shot.victory.winner, CAMP.GOOD); return; }
    }

    // —— 白天：全体存活者投票，精准投出一只狼。
    const wolfTarget = idsOf(seats, ROLES.WEREWOLF)[0];
    if (!wolfTarget) break;
    const voters = seats.filter((seat) => seat.alive && seat.id !== wolfTarget);
    const vote = resolveVote(new Map(voters.map((seat) => [seat.id, wolfTarget])));
    assert.equal(vote.outcome, 'exile');

    const exiled = resolveExile(seats, STD9, vote.exiled, night);
    seats = exiled.seats;
    if (exiled.victory.over) {
      assert.equal(exiled.victory.winner, CAMP.GOOD);
      assert.equal(exiled.victory.reason, REASON.ALL_WOLVES_DEAD);
      return;
    }
    if (exiled.pendingHunter) {
      const shot = resolveHunterShot(seats, STD9, exiled.pendingHunter, idsOf(seats, ROLES.WEREWOLF)[0], night);
      seats = shot.seats;
      if (shot.victory.over) return;
    }
  }
  assert.fail('游戏没有在合理轮次内结束');
});

test('a wolf-favoured game terminates instead of looping forever', () => {
  let seats = deal(STD9, PLAYERS, 'wolf-seed');
  let night = 0;

  // 好人永远投不中（每天投出一个好人），狼每晚精准击杀 —— 必须很快终局。
  for (let guard = 0; guard < 20; guard += 1) {
    night += 1;
    const wolves = seats.filter((seat) => seat.alive && seat.role === ROLES.WEREWOLF).map((seat) => seat.id);
    const prey = seats.find((seat) => seat.alive && seat.role !== ROLES.WEREWOLF);
    if (!prey) break;
    const { target } = tallyWolfPicks(new Map(wolves.map((wolf) => [wolf, prey.id])));
    const resolved = resolveNight(seats, STD9, { wolfTarget: target, night });
    seats = resolved.seats;
    if (resolved.victory.over) {
      assert.equal(resolved.victory.winner, CAMP.WOLF);
      assert.ok(night <= 6, `应在 6 夜内终局，实际 ${night}`);
      return;
    }
    // 好人误投一个好人出局。
    const scapegoat = seats.find((seat) => seat.alive && seat.role !== ROLES.WEREWOLF);
    if (!scapegoat) break;
    const exiled = resolveExile(seats, STD9, scapegoat.id, night);
    seats = exiled.seats;
    if (exiled.victory.over) { assert.equal(exiled.victory.winner, CAMP.WOLF); return; }
  }
  assert.fail('狼优势局没有终局');
});

test('every seed deals a valid board and reaches a terminal state', () => {
  for (let index = 0; index < 25; index += 1) {
    let seats = deal(STD9, PLAYERS, `sweep-${index}`);
    const counts = {};
    for (const seat of seats) counts[seat.role] = (counts[seat.role] || 0) + 1;
    assert.deepEqual(counts, { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 }, `seed ${index} 发牌不合法`);

    // 反复夜杀，确认一定收敛到终局而不是死循环。
    let over = false;
    for (let night = 1; night <= 12 && !over; night += 1) {
      const prey = seats.find((seat) => seat.alive && seat.role !== ROLES.WEREWOLF);
      if (!prey) break;
      const resolved = resolveNight(seats, STD9, { wolfTarget: prey.id, night });
      seats = resolved.seats;
      over = resolved.victory.over;
    }
    assert.ok(over, `seed ${index} 未能收敛到终局`);
    assert.equal(checkVictory(seats, STD9).winner, CAMP.WOLF);
  }
});

test('a peaceful night reveals no deaths and keeps the game going', () => {
  const seats = deal(STD9, PLAYERS, 'quiet');
  const resolved = resolveNight(seats, STD9, { wolfTarget: null, night: 1 });
  assert.deepEqual(resolved.deaths, []);
  assert.equal(resolved.victory.over, false);
  assert.ok(resolved.seats.every((seat) => seat.alive));
});

test('death cause is recorded for the rules but stays out of public seats', () => {
  const seats = deal(STD9, PLAYERS, 'cause');
  const victim = seats.find((seat) => seat.role === ROLES.VILLAGER);
  const resolved = resolveNight(seats, STD9, { wolfTarget: victim.id, night: 1 });
  const dead = resolved.seats.find((seat) => seat.id === victim.id);
  assert.equal(dead.deathCause, DEATH.WOLF);

  const state = { gameId: 'g', boardId: 'std9', phase: 'dawn', night: 1, day: 1,
    seats: resolved.seats, publicLog: [], wolfPicks: new Map(), wolfChat: [], seerChecks: [],
    witchPotions: { save: true, poison: true } };
  const onlooker = resolved.seats.find((seat) => seat.alive && seat.role === ROLES.VILLAGER);
  const view = viewFor(state, onlooker.id, STD9);
  const exposed = view.seats.find((seat) => seat.id === victim.id);
  assert.equal(exposed.alive, false, '死讯公开');
  assert.ok(!Object.hasOwn(exposed, 'deathCause'), '死因不公开：被毒会暴露女巫已用毒');
});
