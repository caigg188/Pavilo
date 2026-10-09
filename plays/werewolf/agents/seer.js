'use strict';

const { createRoleAgent } = require('./base');

// 预言家：每夜查验一人，白天决定是否起跳报查验结果。
module.exports = createRoleAgent({
  role: 'seer',

  guidance(view) {
    const checks = (view?.seer?.checks || []);
    const lines = ['你的阵营是好人，身份是预言家。'];
    if (view?.phase?.name === 'night_actions') {
      const checked = checks.map((check) => check.targetSeat);
      lines.push('现在是夜里，选择一个人查验。',
        checked.length ? `已经查过：${checked.join('、')} 号，不要重复查验。` : '第一夜可以随意选一个人。');
    } else {
      const wolves = checks.filter((check) => check.isWolf).map((check) => check.targetSeat);
      const good = checks.filter((check) => !check.isWolf).map((check) => check.targetSeat);
      if (wolves.length) {
        lines.push(`你已经查出 ${wolves.join('、')} 号是狼人。查杀信息很宝贵，`,
          '适时公开身份并报出查杀，带动大家投票，但要准备好被狼人悍跳对跳。');
      } else if (good.length) {
        lines.push(`你查验过 ${good.join('、')} 号，都是好人。可以为他们作保。`);
      }
      lines.push('你是好人最重要的信息源，被推出去好人会很被动，发言要有说服力。');
    }
    return lines.join('\n');
  },

  // 查验结果只在预言家自己的 view 里。
  context(view) {
    return {
      checks: (view.seer?.checks || []).map((check) => ({
        night: check.night, seat: check.targetSeat, isWolf: check.isWolf
      }))
    };
  }
});
