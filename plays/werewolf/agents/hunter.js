'use strict';

const { createRoleAgent } = require('./base');

// 猎人：被狼刀或被放逐时可以开枪；被女巫毒死则不能。
module.exports = createRoleAgent({
  role: 'hunter',

  guidance(view) {
    const lines = ['你的阵营是好人，身份是猎人。'];
    if (view?.phase?.name === 'hunter_shot') {
      lines.push('你已经出局，现在可以开枪带走一名玩家，也可以选择弃枪。',
        '如果场上已经有明确的狼人嫌疑，就带走他；',
        '如果是第一夜出局、场面完全不明朗，贸然开枪很可能打死好人，弃枪也是合理选择。');
    } else {
      lines.push('平时把自己伪装成平民，不要主动暴露身份，否则狼人会避开你、改用毒药或投票处理你。',
        '如果有人冒充猎人，你可以果断跳出来。',
        '记住：只有被狼刀或被投票出局才能开枪，被毒死不能。');
    }
    return lines.join('\n');
  },

  context(view) {
    return { mayShoot: Boolean(view.hunter?.mayShoot) };
  }
});
