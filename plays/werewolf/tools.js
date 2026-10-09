'use strict';

// 角色行为工具。人点按钮、Agent 调网关 function calling，最后都变成
// 同一条 playAction，由 machine.dispatch 裁决。模型不能发明工具。

const CATALOG = [
  {
    tool: 'wolf_kill',
    action: 'wolfPick',
    description: '夜晚狼人投票刀人。三狼多数决，平票或空刀则今晚无人被刀。优先与已经提名的队友统一目标。',
    targetField: 'target',
    allowNullTarget: true
  },
  {
    tool: 'wolf_chat',
    action: 'wolfChat',
    description: '狼队私聊，只有狼人看得见。用来商量刀口，不要在这里说废话。',
    textField: 'text'
  },
  {
    tool: 'seer_check',
    action: 'seerCheck',
    description: '预言家查验一名玩家是狼人还是好人。每晚只能查一次。',
    targetField: 'target'
  },
  {
    tool: 'witch_save',
    action: 'witchSave',
    description: '女巫使用解药，救下今晚被刀的人。全场只有一瓶。'
  },
  {
    tool: 'witch_poison',
    action: 'witchPoison',
    description: '女巫使用毒药毒死一名玩家。与解药不能同一晚使用。',
    targetField: 'target'
  },
  {
    tool: 'witch_pass',
    action: 'witchPass',
    description: '女巫本晚不用药。'
  },
  {
    tool: 'hunter_shoot',
    action: 'hunterShoot',
    description: '猎人开枪带走一名玩家。',
    targetField: 'target'
  },
  {
    tool: 'hunter_pass',
    action: 'hunterPass',
    description: '猎人弃枪。'
  },
  {
    tool: 'speak',
    action: 'speak',
    description: '公开发言。口语中文，可长可短，但必须有完整判断：怀疑谁、为什么、这轮想出谁。点名必须把话说完。不要说「我先过」「听听后面的」。',
    textField: 'text'
  },
  {
    tool: 'end_speech',
    action: 'endSpeech',
    description: '结束本轮发言。如果还没说过实质性内容，不要调用。'
  },
  {
    tool: 'vote',
    action: 'vote',
    description: '投票放逐一名玩家。按你预测表里最像狼的人投，不要无脑跟票。',
    targetField: 'target'
  },
  {
    tool: 'abstain',
    action: 'abstain',
    description: '本轮弃票。'
  }
];

const BY_ACTION = new Map(CATALOG.map((entry) => [entry.action, entry]));
const BY_TOOL = new Map(CATALOG.map((entry) => [entry.tool, entry]));

function actionsNamed(legalActions, name) {
  return (legalActions || []).filter((action) => action && action.name === name);
}

function toolsFromLegalActions(legalActions) {
  const tools = [];
  for (const entry of CATALOG) {
    const matches = actionsNamed(legalActions, entry.action);
    if (!matches.length) continue;
    const properties = {};
    const required = [];
    if (entry.targetField) {
      const values = [];
      for (const action of matches) {
        const target = action.payload ? action.payload[entry.targetField] : undefined;
        if (target == null && entry.allowNullTarget) values.push('');
        else if (typeof target === 'string') values.push(target);
      }
      const unique = [...new Set(values)];
      if (!unique.length) continue;
      properties[entry.targetField] = {
        type: 'string',
        description: entry.allowNullTarget
          ? '玩家 id；空字符串表示空刀'
          : '玩家 id，必须从枚举中原样复制',
        enum: unique
      };
      required.push(entry.targetField);
    }
    if (entry.textField) {
      properties[entry.textField] = { type: 'string', description: '要说的话' };
      required.push(entry.textField);
    }
    tools.push({
      type: 'function',
      function: {
        name: entry.tool,
        description: entry.description,
        parameters: { type: 'object', properties, required }
      }
    });
  }
  return tools;
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function actionFromToolCall(call) {
  const fn = call?.function || call;
  const name = fn?.name || call?.name;
  const entry = BY_TOOL.get(name);
  if (!entry) return null;
  const args = parseArguments(fn?.arguments ?? call?.arguments);
  const payload = {};
  if (entry.targetField) {
    const value = args[entry.targetField];
    payload[entry.targetField] = (value == null || value === '') ? null : String(value);
  }
  if (entry.textField) payload[entry.textField] = String(args[entry.textField] || '');
  return { name: entry.action, payload };
}

function toolNameForAction(actionName) {
  return BY_ACTION.get(actionName)?.tool || actionName;
}

module.exports = {
  CATALOG,
  toolsFromLegalActions,
  actionFromToolCall,
  toolNameForAction
};
