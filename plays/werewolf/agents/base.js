'use strict';

const { createPlayAgent, extractJson } = require('../../../src/play/agent');
const { baseSystem, roleName } = require('../prompts/rules');
const { parsePlan, actionFromPlan } = require('./talk');

// 所有角色共用同一条循环：拼 prompt → complete → 解析 → 必须落在
// legalActions 内 → onAction。差别只有「角色指引」与「私密上下文」。
//
// Agent 的 privateView 就是 host.snapshot(actor)，也就是 visibility.viewFor
// 的产物 —— 它物理上拿不到别人的身份，非上帝视角是架构保证，不是提示词约束。

// 网关不可用、模型超时、返回非法动作时的兜底。
// 绝不能返回 skip 了事：三只狼全是 Agent 且网关挂掉时，
// 每晚空刀会让游戏永远打不完。必须从合法动作里挑一个。
function fallbackAction(ctx) {
  const legal = (ctx.legalActions || []).filter((action) => action.name !== 'skip');
  if (!legal.length) return { name: 'skip', payload: {} };

  // 发言类：给一句中性的话，别让场面卡住。
  const speak = legal.find((action) => action.name === 'speak');
  if (speak) return { name: 'speak', payload: { text: '我先过，听听后面的。' } };

  // 优先选「不做事」的安全项，避免乱投票、乱开枪伤到自己人。
  const passLike = legal.find((action) => ['witchPass', 'hunterPass', 'abstain', 'endSpeech'].includes(action.name));
  if (passLike) return { name: passLike.name, payload: passLike.payload || {} };

  // 只剩带目标的动作（例如狼人必须给出刀口）：随机挑一个合法目标。
  // wolfChat 要求自带文本，随手选中它只会被拒绝、白白浪费这一回合，
  // 所以不参与兜底；它也不推进任何阶段。
  const actionable = legal.filter((action) => action.name !== 'wolfChat');
  if (!actionable.length) return { name: 'skip', payload: {} };
  const index = Math.floor(Math.random() * actionable.length);
  const picked = actionable[index];
  return { name: picked.name, payload: picked.payload || {} };
}

function createRoleAgent({ role, guidance, context }) {
  return createPlayAgent({
    role,
    timeoutMs: 20_000,
    maxTokens: 300,

    system(ctx) {
      return baseSystem(ctx.privateView, guidance(ctx.privateView));
    },

    view(ctx) {
      const view = ctx.privateView || {};
      const extra = context ? context(view) : null;
      return {
        phase: view.phase?.name,
        night: view.phase?.night,
        day: view.phase?.day,
        me: view.self ? { seat: view.self.seat, role: roleName(view.self.role), alive: view.self.alive } : null,
        seats: (view.seats || []).map((seat) => ({ seat: seat.seat, name: seat.username, alive: seat.alive })),
        ...(extra ? { private: extra } : {})
      };
    },

    parse(text, ctx) {
      // Accept both the standard {name, payload} format and the think-plan
      // {thought, say, targetSeat, ...} format that planAndAct produces.
      const plan = parsePlan(text);
      if (plan) {
        const action = actionFromPlan(plan, ctx);
        if (action) return action;
      }
      return extractJson(text);
    },

    schema(ctx) { return ctx.legalActions || []; },
    onInvalid(ctx) { return fallbackAction(ctx); }
  });
}

module.exports = { createRoleAgent, fallbackAction };
