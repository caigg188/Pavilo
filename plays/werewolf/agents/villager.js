'use strict';

const { createRoleAgent } = require('./base');

// 平民：没有技能，只有发言和投票。
module.exports = createRoleAgent({
  role: 'villager',

  guidance() {
    return [
      '你的阵营是好人，身份是平民，没有任何夜间技能。',
      '你的价值在于发言和投票：认真听每个人的逻辑，找出矛盾。',
      '注意谁在跳预言家、谁的说法前后不一致、谁在无理由地带节奏。',
      '不要假装自己有身份（那会干扰真正的神职），但要敢于表达判断。'
    ].join('\n');
  }
});
