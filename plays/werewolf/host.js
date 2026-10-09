'use strict';

const { createMachine } = require('./machine');
const { specFor } = require('./agents');

// 编排层：把 playAction 路由到状态机，把状态机的变化投影成 playState。
// 规则全部在 machine.js 与 rules/ 里，这里不做裁决。
function create(runtime) {
  let pushing = false;

  const machine = createMachine({
    now: runtime.now,
    schedule: runtime.schedule,
    randomId: runtime.randomId,
    // 占座要走契约的 seatAgent；machine 自己不碰宿主。
    seatAgent: ({ username }) => runtime.seatAgent({ username, role: 'player' }),
    // 身份是发牌后才知道的，所以 spec 在每个回合按角色现取。
    // Agent 的上下文只有 host.snapshot(actor) —— 拿不到别人的身份。
    requestTurn: (actor, turn) => {
      runtime.requestTurn(actor, { legalActions: turn.legalActions, spec: specFor(turn.role) });
    },
    // 阶段推进可能由 deadline 触发，此时没有 onAction 返回值可搭便车。
    onChange: () => pushAll()
  });

  // 每个人拿到的都是自己的私密投影，绝不广播一份公共 state：
  // visibility.js 的 channelView 已经剔除身份，但逐人投影更不容易出错。
  function snapshotsForAll() {
    const actors = runtime.actors() || [];
    return actors.map((actor) => ({
      visibility: 'private',
      actorId: actor.id,
      state: machine.snapshot(actor.id)
    }));
  }

  function persist() {
    try { runtime.save(machine.serialize()); } catch { /* 存档失败不影响对局 */ }
  }

  function pushAll() {
    // onChange 会在 dispatch 内部同步触发；此时同样要推，
    // 否则超时推进的那一次就没人收得到。
    if (pushing) return;
    pushing = true;
    try {
      runtime.emit(snapshotsForAll());
      persist();
    } finally {
      pushing = false;
    }
  }

  function selfSnapshot(actor) {
    return { visibility: 'private', actorId: actor.id, state: machine.snapshot(actor.id) };
  }

  return {
    onJoin(actor) {
      // 进来先看到当前局面；坐座是显式动作，不自动占位。
      return { ok: true, snapshots: [selfSnapshot(actor)] };
    },

    onLeave() {
      // 座位保留：断线重连仍是同一个座位。真正的退出由 lobby 的 stand 处理。
    },

    snapshot(actor) {
      return machine.snapshot(actor?.id);
    },

    onAction(actor, { name, payload }) {
      const result = machine.dispatch(actor.id, { name, payload });
      if (!result.ok) {
        return { ok: false, code: result.code, message: result.message };
      }
      // 动作若改变了公共局面，onChange 已经推给所有人；
      // 这里再给发起者一份，带上 clientActionId 便于前端对账。
      const out = { ok: true, snapshots: [selfSnapshot(actor)] };
      if (result.post) out.post = result.post;
      if (!machine.phase) persist();
      return out;
    },

    hydrate(saved) {
      return machine.hydrate(saved);
    }
  };
}

module.exports = { id: 'werewolf', create };
