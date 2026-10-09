(() => {
  'use strict';

  // 玩法页自带词典：官方仓库要求简体中文 + 英语（docs/play.md §9）。
  const DICT = {
    'zh-CN': {
      title: '狼人杀',
      connecting: '连接中…',
      online: '已连接',
      offline: '连接断开',
      leave: '离开',
      restart: '再来一局',
      'say.placeholder': '轮到你发言…',
      'say.send': '发言',
      'say.end': '结束发言',
      'wolf.title': '狼队频道',
      'wolf.placeholder': '和队友商量…',

      'board.std9': '9 人标准局',
      'seat.empty': '空位',
      'seat.you': '你',
      'seat.dead': '出局',
      'seat.speaking': '发言中',
      'seat.teammate': '同伴',

      'phase.lobby': '等待开始',
      'phase.dealing': '发牌',
      'phase.night_actions': '天黑请闭眼',
      'phase.night_witch': '女巫请睁眼',
      'phase.dawn': '天亮了',
      'phase.last_words': '遗言',
      'phase.hunter_shot': '猎人开枪',
      'phase.day_speech': '白天讨论',
      'phase.day_vote': '投票放逐',
      'phase.vote_result': '唱票',
      'phase.pk_speech': '平票 PK',
      'phase.pk_vote': 'PK 投票',
      'phase.exile_last_words': '遗言',
      'phase.game_over': '对局结束',

      'hint.lobby': '坐下并邀请同伴，或添加 AI 补齐 9 人。',
      'hint.night_actions': '狼人正在行动，其他人请安静等待。',
      'hint.night_wolf': '和队友商量今晚的目标，截止前可以改。',
      'hint.night_seer': '选择一名玩家查验身份。',
      'hint.night_witch': '女巫正在考虑用药。',
      'hint.witch_self': '今晚的情况只有你知道，谨慎用药。',
      'hint.dawn': '昨晚的结果已公布。',
      'hint.last_words': '请留下遗言。',
      'hint.hunter_shot': '猎人可以带走一名玩家，也可以弃枪。',
      'hint.day_speech': '轮流发言，说完点「结束发言」。',
      'hint.day_vote': '投出你认为的狼人，也可以弃票。',
      'hint.vote_result': '正在唱票…',
      'hint.pk_speech': '平票玩家依次发言。',
      'hint.pk_vote': '平票玩家不参与本轮投票。',
      'hint.game_over': '身份已全部揭晓。',
      'hint.waiting': '等待其他玩家…',
      'hint.dead': '你已出局，可以继续观战。',

      'role.seer': '预言家',
      'role.witch': '女巫',
      'role.hunter': '猎人',
      'role.villager': '平民',
      'role.werewolf': '狼人',

      'act.sit': '坐下',
      'act.stand': '离座',
      'act.start': '开始游戏',
      'act.addAgent': '添加 AI',
      'act.wolfPick': '刀',
      'act.wolfPickNone': '空刀',
      'act.seerCheck': '查验',
      'act.witchSave': '使用解药',
      'act.witchPoison': '毒',
      'act.witchPass': '不用药',
      'act.vote': '投',
      'act.abstain': '弃票',
      'act.hunterShoot': '带走',
      'act.hunterPass': '弃枪',

      'win.good': '好人胜利',
      'win.wolf': '狼人胜利',
      'reason.ALL_WOLVES_DEAD': '狼人全部出局',
      'reason.GODS_WIPED': '神职全部出局',
      'reason.VILLAGERS_WIPED': '平民全部出局',
      'reason.TOWN_WIPED': '好人全部出局',
      'reason.UNSTOPPABLE': '狼人数量已压过好人',

      'log.started': '游戏开始，共 {seats} 人。',
      'log.nightFell': '第 {night} 夜，天黑请闭眼。',
      'log.dawn_none': '天亮了。昨晚是平安夜。',
      'log.dawn_some': '天亮了。{seats} 号倒牌。',
      'log.dayBegan': '第 {day} 天，开始发言。',
      'log.voteResult_exile': '投票结果：{seat} 号被放逐。',
      'log.voteResult_tie': '平票：{seats} 号进入 PK。',
      'log.voteResult_none': '本轮无人出局。',
      'log.hunterShot': '猎人开枪带走了 {seat} 号。',
      'log.gameOver': '对局结束：{winner}。',
      'log.checked': '查验结果：{seat} 号是{result}。',
      'log.isWolf': '狼人',
      'log.notWolf': '好人',
      'log.youDied': '你已出局。',
      'log.saved': '你使用了解药。',
      'log.poisoned': '你毒杀了 {seat} 号。'
    },

    en: {
      title: 'Werewolf',
      connecting: 'Connecting…',
      online: 'Online',
      offline: 'Disconnected',
      leave: 'Leave',
      restart: 'Play again',
      'say.placeholder': 'Your turn to speak…',
      'say.send': 'Speak',
      'say.end': 'End turn',
      'wolf.title': 'Wolf channel',
      'wolf.placeholder': 'Talk to your pack…',

      'board.std9': '9-player standard',
      'seat.empty': 'Empty',
      'seat.you': 'You',
      'seat.dead': 'Out',
      'seat.speaking': 'Speaking',
      'seat.teammate': 'Pack',

      'phase.lobby': 'Waiting to start',
      'phase.dealing': 'Dealing',
      'phase.night_actions': 'Night falls',
      'phase.night_witch': 'Witch awakes',
      'phase.dawn': 'Dawn',
      'phase.last_words': 'Last words',
      'phase.hunter_shot': "Hunter's shot",
      'phase.day_speech': 'Discussion',
      'phase.day_vote': 'Vote',
      'phase.vote_result': 'Counting',
      'phase.pk_speech': 'Runoff speech',
      'phase.pk_vote': 'Runoff vote',
      'phase.exile_last_words': 'Last words',
      'phase.game_over': 'Game over',

      'hint.lobby': 'Take a seat and invite others, or add AI to fill all 9.',
      'hint.night_actions': 'The wolves are choosing. Everyone else, stay quiet.',
      'hint.night_wolf': 'Agree on tonight’s target. You can change it before time runs out.',
      'hint.night_seer': 'Choose a player to investigate.',
      'hint.night_witch': 'The witch is deciding.',
      'hint.witch_self': 'Only you know what happened tonight. Choose carefully.',
      'hint.dawn': 'Last night’s outcome is in.',
      'hint.last_words': 'Leave your last words.',
      'hint.hunter_shot': 'The hunter may take someone down, or hold fire.',
      'hint.day_speech': 'Speak in turn, then end your turn.',
      'hint.day_vote': 'Vote out a suspected wolf, or abstain.',
      'hint.vote_result': 'Counting the votes…',
      'hint.pk_speech': 'Tied players speak in turn.',
      'hint.pk_vote': 'Tied players do not vote this round.',
      'hint.game_over': 'All roles revealed.',
      'hint.waiting': 'Waiting for the others…',
      'hint.dead': 'You are out. You can keep watching.',

      'role.seer': 'Seer',
      'role.witch': 'Witch',
      'role.hunter': 'Hunter',
      'role.villager': 'Villager',
      'role.werewolf': 'Werewolf',

      'act.sit': 'Sit',
      'act.stand': 'Stand',
      'act.start': 'Start',
      'act.addAgent': 'Add AI',
      'act.wolfPick': 'Kill',
      'act.wolfPickNone': 'No kill',
      'act.seerCheck': 'Check',
      'act.witchSave': 'Use antidote',
      'act.witchPoison': 'Poison',
      'act.witchPass': 'No potion',
      'act.vote': 'Vote',
      'act.abstain': 'Abstain',
      'act.hunterShoot': 'Shoot',
      'act.hunterPass': 'Hold fire',

      'win.good': 'Village wins',
      'win.wolf': 'Wolves win',
      'reason.ALL_WOLVES_DEAD': 'Every wolf is out',
      'reason.GODS_WIPED': 'All special roles are out',
      'reason.VILLAGERS_WIPED': 'All villagers are out',
      'reason.TOWN_WIPED': 'The village is wiped out',
      'reason.UNSTOPPABLE': 'Wolves now outnumber the village',

      'log.started': 'Game started with {seats} players.',
      'log.nightFell': 'Night {night}. Everyone, close your eyes.',
      'log.dawn_none': 'Dawn breaks. Nobody died last night.',
      'log.dawn_some': 'Dawn breaks. Seat {seats} is out.',
      'log.dayBegan': 'Day {day}. Discussion begins.',
      'log.voteResult_exile': 'Vote result: seat {seat} is exiled.',
      'log.voteResult_tie': 'Tied: seats {seats} go to a runoff.',
      'log.voteResult_none': 'Nobody was exiled this round.',
      'log.hunterShot': 'The hunter took down seat {seat}.',
      'log.gameOver': 'Game over: {winner}.',
      'log.checked': 'Result: seat {seat} is {result}.',
      'log.isWolf': 'a werewolf',
      'log.notWolf': 'not a werewolf',
      'log.youDied': 'You are out.',
      'log.saved': 'You used the antidote.',
      'log.poisoned': 'You poisoned seat {seat}.'
    }
  };

  const KEY = 'pavilo.lang';

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && DICT[saved]) return saved;
    } catch { /* ignore */ }
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  }

  function createI18n() {
    let lang = detect();
    function t(key, vars) {
      const table = DICT[lang] || DICT['zh-CN'];
      let text = table[key] ?? DICT['zh-CN'][key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value);
      }
      return text;
    }
    return {
      t,
      get lang() { return lang; },
      other() { return lang === 'zh-CN' ? 'en' : 'zh-CN'; },
      set(next) {
        if (!DICT[next]) return;
        lang = next;
        try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
        document.documentElement.lang = next;
      },
      apply(root = document) {
        for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
        for (const node of root.querySelectorAll('[data-i18n-ph]')) node.placeholder = t(node.dataset.i18nPh);
      }
    };
  }

  window.WerewolfI18n = { createI18n, DICT };
})();
