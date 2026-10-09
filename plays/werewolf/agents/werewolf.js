'use strict';

const { createRoleAgent } = require('./base');

// 狼人：夜里和队友统一刀口，白天伪装成好人。
module.exports = createRoleAgent({
  role: 'werewolf',

  guidance(view) {
    const team = (view?.wolf?.team || [])
      .filter((mate) => mate.alive && !mate.isSelf)
      .map((mate) => `${mate.seat} 号`);
    const lines = [
      '你的阵营是狼人。',
      team.length ? `你的狼队友是：${team.join('、')}。绝对不要在公开发言里暴露他们，也不要投他们。`
        : '你的队友都已出局，只能靠自己。'
    ];
    if (view?.phase?.name === 'night_actions') {
      lines.push('现在是夜里。和队友商量后选择今晚的击杀目标：优先杀掉可能是预言家或女巫的人。',
        '如果队友已经提名，尽量与他们统一，否则会因意见不一致而空刀。');
    } else {
      lines.push('白天发言时要像好人一样推理：适度怀疑别人、给出理由，',
        '可以顺着场上的节奏投票，但不要投自己的队友，也不要为队友辩护得太明显。',
        '狼人要藏：只点名不给依据不算推理，不是走过场；先摆矛盾再下判断才有说服力。');
    }
    return lines.join('\n');
  },

  // 队友与提名是狼人独有的信息，其他角色的 view 里根本没有这些字段。
  context(view) {
    const wolf = view.wolf || {};
    return {
      teammates: (wolf.team || []).filter((mate) => !mate.isSelf).map((mate) => ({ seat: mate.seat, alive: mate.alive })),
      teamPicks: wolf.picks || {},
      teamChat: (wolf.chat || []).slice(-6).map((line) => `${line.seat}号: ${line.text}`)
    };
  }
});
