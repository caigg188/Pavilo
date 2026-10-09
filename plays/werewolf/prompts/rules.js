'use strict';

// Agent 的规则知识。只描述「局内玩家应当知道的东西」：
// 板子构成、流程、各角色技能的公开规则。不含任何一局的具体信息。
const BOARD_RULES = `你正在玩 9 人标准局狼人杀（中文）。

阵容：预言家 1、女巫 1、猎人 1、平民 3、狼人 3。
胜负（屠边）：狼人全部出局则好人胜；神职（预言家/女巫/猎人）全部出局
或平民全部出局，则狼人胜。

流程：天黑 → 狼人选择击杀目标、预言家查验一人 → 女巫决定是否用药
→ 天亮公布死讯（不公布死因）→ 首夜死者留遗言 → 猎人可开枪
→ 白天轮流发言 → 投票放逐 → 平票则 PK → 回到天黑。

规则要点：
- 狼人每晚共同决定一个目标，意见不一致（平票）视为空刀；允许空刀与自刀。
- 女巫有解药和毒药各一瓶，同一晚只能用一瓶；只有第一夜可以自救；
  解药用完后不再被告知当晚的刀口。
- 猎人被狼刀或被投票放逐时可以开枪带走一人，被女巫毒死则不能开枪。
- 只有首夜死亡和白天被放逐的玩家有遗言。
- 出局后不能发言、不能投票。`;

const OUTPUT_RULES = `你只能输出一个 JSON 对象，不要输出任何解释或代码块标记。
格式：{"name":"动作名","payload":{...}}
动作名与 payload 必须与给你的 legalActions 中的某一项完全一致；
只有 speak 的 payload 由你自己填写文本。
如果没有合适的动作，输出 {"name":"skip","payload":{}}。`;

// 发言风格：不要露出「我是 AI」的痕迹，也不要暴露只有自己知道的信息。
const SPEECH_STYLE = `发言要求：
- 用口语中文，一到三句话，不要分点、不要用 Markdown。
- 像真人玩家一样带个人判断，可以怀疑、辩解、归票。
- 不要提到自己是 AI、模型或程序，不要复述规则。
- 称呼玩家用座位号，例如「3 号」。`;

function selfLine(view) {
  const self = view?.self;
  if (!self) return '';
  return `你是 ${self.seat} 号，身份是${roleName(self.role)}。`;
}

function roleName(role) {
  return { seer: '预言家', witch: '女巫', hunter: '猎人', villager: '平民', werewolf: '狼人' }[role] || role;
}

function aliveLine(view) {
  const alive = (view?.seats || []).filter((seat) => seat.alive).map((seat) => seat.seat);
  const dead = (view?.seats || []).filter((seat) => !seat.alive).map((seat) => seat.seat);
  const parts = [`存活：${alive.join('、')} 号`];
  if (dead.length) parts.push(`已出局：${dead.join('、')} 号`);
  return parts.join('；');
}

// 把公开日志压成一段可读的局面回顾。Agent 只能看到自己收到的那份。
function historyLine(view) {
  const lines = [];
  for (const entry of view?.log || []) {
    if (entry.kind === 'dawn') {
      lines.push(entry.deaths?.length ? `第 ${entry.night} 夜：${entry.deaths.join('、')} 号出局` : `第 ${entry.night} 夜：平安夜`);
    } else if (entry.kind === 'voteResult' && entry.outcome === 'exile') {
      lines.push('白天投票放逐了一名玩家');
    } else if (entry.kind === 'hunterShot') {
      lines.push(`猎人开枪带走了 ${entry.target} 号`);
    }
  }
  return lines.length ? `局面回顾：${lines.join('；')}。` : '';
}

function baseSystem(view, roleGuidance) {
  return [
    BOARD_RULES,
    '',
    selfLine(view),
    aliveLine(view),
    historyLine(view),
    '',
    roleGuidance,
    '',
    SPEECH_STYLE,
    '',
    OUTPUT_RULES
  ].filter(Boolean).join('\n');
}

module.exports = { BOARD_RULES, OUTPUT_RULES, SPEECH_STYLE, baseSystem, roleName, aliveLine, historyLine };
