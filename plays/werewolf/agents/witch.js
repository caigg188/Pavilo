'use strict';

const { createRoleAgent } = require('./base');

// 女巫：解药毒药各一瓶，同夜只能用一瓶，只有首夜能自救。
module.exports = createRoleAgent({
  role: 'witch',

  guidance(view) {
    const witch = view?.witch || {};
    const potions = witch.potions || {};
    const lines = ['你的阵营是好人，身份是女巫。'];
    if (view?.phase?.name === 'night_witch') {
      if (witch.tonightKill) {
        lines.push(`今晚 ${seatOf(view, witch.tonightKill)} 号被狼人袭击。`);
        if (witch.mayUseSave) {
          lines.push('你可以用解药救他。第一夜通常建议救人，因为此时无法判断他的身份，',
            '不救可能直接失去一个神职。');
        } else {
          lines.push('但你现在不能救他（解药已用完，或规则不允许此时自救）。');
        }
      } else if (potions.save) {
        lines.push('今晚没有人被袭击，或者你已经无法得知刀口。');
      } else {
        lines.push('你的解药已经用完，因此不会再被告知每晚的刀口。');
      }
      if (witch.mayUsePoison) {
        lines.push('你也可以用毒药毒死一名玩家，但同一晚不能既用解药又用毒药。',
          '毒药很珍贵，没有把握时可以先不用。');
      }
      lines.push('如果都不想用，就选择不用药。');
    } else {
      lines.push(`药剂状态：解药${potions.save ? '未用' : '已用'}，毒药${potions.poison ? '未用' : '已用'}。`,
        '白天不要轻易暴露身份，否则容易被狼人针对；但在关键时刻可以用信息帮好人。');
    }
    return lines.join('\n');
  },

  // 刀口与药剂只在女巫自己的 view 里。
  context(view) {
    const witch = view.witch || {};
    return {
      tonightKillSeat: witch.tonightKill ? seatOf(view, witch.tonightKill) : null,
      potions: witch.potions,
      mayUseSave: witch.mayUseSave,
      mayUsePoison: witch.mayUsePoison
    };
  }
});

function seatOf(view, id) {
  return (view.seats || []).find((seat) => seat.id === id)?.seat ?? null;
}
