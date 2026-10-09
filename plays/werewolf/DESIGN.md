# 官方狼人杀 · 9 人标准局设计

本文是 `plays/werewolf/` 的实现蓝图。契约见 [docs/play.md](../../docs/play.md)，对照夹具 [`plays/echo/`](../echo/)。

> 主持人是确定性状态机，LLM 不裁决规则。所有身份信息只经 `visibility.js` 投影。

---

## 1. 板子：9 人标准局

| 阵营 | 角色 | 数量 |
| --- | --- | --- |
| 好人 · 神职 | 预言家 `seer` | 1 |
| 好人 · 神职 | 女巫 `witch` | 1 |
| 好人 · 神职 | 猎人 `hunter` | 1 |
| 好人 · 平民 | 平民 `villager` | 3 |
| 狼人 | 狼人 `werewolf` | 3 |

3 神 + 3 民 + 3 狼，共 9 座。**首版不做警长**：9 人局警徽是可选的，而竞选发言、警徽流、归票、1.5 票、移交/撕警徽是一整套独立规则，复杂度超过三个神职之和。

### 1.1 板子开关

```js
{
  id: 'std9',
  seats: 9,
  roles: { seer: 1, witch: 1, hunter: 1, villager: 3, werewolf: 3 },
  victory: 'edge',        // 'edge' 屠边 | 'town' 屠城
  witchSelfSaveNight: 1,  // 女巫仅第 N 夜可自救；0 = 永不可
  witchDoublePotion: false, // 同夜双药
  lastWordsNights: [1],   // 哪些夜晚的死者有遗言
  hunterCanShoot: { wolfKill: true, exile: true, poison: false }
}
```

**`victory` 默认 `edge`（屠边）**：主流 App 与「9 人标准屠边局」都用这个，是玩家的默认预期。但 9 人屠边狼人优势明显，线下常改 `town`（屠城）平衡，因此做成开关而不是写死。

---

## 2. 阶段状态机

```
                    ┌─────────┐
                    │  lobby  │  坐座 / 加 Agent / 选板子
                    └────┬────┘
                         │ start（恰好 9 座）
                    ┌────▼────┐
                    │ dealing │  洗牌发身份（瞬时）
                    └────┬────┘
        ┌────────────────▼────────────────┐
        │        night_actions            │  狼人刀 + 预言家查验（并发）
        └────────────────┬────────────────┘
                    ┌────▼────────┐
                    │ night_witch │  女巫（知道刀口）
                    └────┬────────┘
                    ┌────▼────┐
                    │  dawn   │  结算 + 公布死讯（不公布死因）
                    └────┬────┘
              ┌──────────▼──────────┐
              │  last_words（条件）  │  仅首夜死者，按座号顺序
              └──────────┬──────────┘
              ┌──────────▼──────────┐
              │ hunter_shot（条件）  │  猎人开枪
              └──────────┬──────────┘
                 ┌───────▼───────┐
                 │  day_speech   │  轮流发言
                 └───────┬───────┘
                 ┌───────▼───────┐
                 │   day_vote    │  投票放逐
                 └───────┬───────┘
                 ┌───────▼───────┐
                 │  vote_result  │  唱票
                 └───┬───────┬───┘
              平票   │       │ 出局
              ┌──────▼──┐    │
              │pk_speech│    │
              └──────┬──┘    │
              ┌──────▼──┐    │
              │ pk_vote │    │
              └──────┬──┘    │
                     └───┬───┘
          ┌──────────────▼──────────────┐
          │  exile_last_words（条件）    │  被放逐者遗言
          └──────────────┬──────────────┘
          ┌──────────────▼──────────────┐
          │  hunter_shot（条件）         │
          └──────────────┬──────────────┘
                         │
                    回到 night_actions
                         │
                    ┌────▼──────┐
                    │ game_over │  公布全部身份
                    └───────────┘
```

**每次死亡结算后立即判定胜负**，命中则直接跳 `game_over`。

### 2.1 阶段表

| 阶段 | 可行动者 | 动作 | 退出条件 | 默认时限 |
| --- | --- | --- | --- | --- |
| `lobby` | 全部 | `sit` `stand` `addAgent` `removeAgent` `setBoard` `start` | 满 9 座且发起 `start` | 无 |
| `dealing` | — | 自动 | 瞬时 | — |
| `night_actions` | 狼人、预言家 | `wolfPick` `wolfChat` `seerCheck` | 全部提交或超时 | 60s |
| `night_witch` | 女巫 | `witchSave` `witchPoison` `witchPass` | 提交或超时 | 30s |
| `dawn` | — | 自动 | 停留展示 | 5s |
| `last_words` | 首夜死者 | `speak` `endSpeech` | 结束或超时 | 60s/人 |
| `hunter_shot` | 猎人 | `hunterShoot` `hunterPass` | 提交或超时（超时＝弃枪） | 30s |
| `day_speech` | 当前发言人 | `speak` `endSpeech` | 全员轮完 | 90s/人 |
| `day_vote` | 存活者 | `vote` `abstain` | 全部投出或超时（超时＝弃票） | 30s |
| `vote_result` | — | 自动 | 停留展示 | 5s |
| `pk_speech` | 平票者 | `speak` `endSpeech` | 轮完 | 60s/人 |
| `pk_vote` | 存活且非平票者 | `vote` `abstain` | 全部投出或超时 | 30s |
| `exile_last_words` | 被放逐者 | `speak` `endSpeech` | 结束或超时 | 60s |
| `game_over` | 全部 | `restart` | — | 无 |

---

## 3. 随机发身份

不引入依赖，也不用 `Math.random()`（不可测）。用 `runtime.randomId()` 作熵源喂一个确定性 PRNG：

```js
// rules/deal.js
function seedFrom(text) {                       // FNV-1a
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function next() {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deal(board, seats, randomId) {
  const deck = [];
  for (const [role, count] of Object.entries(board.roles)) {
    for (let i = 0; i < count; i += 1) deck.push(role);
  }
  if (deck.length !== seats.length) throw new Error('board/seat count mismatch');
  const next = mulberry32(seedFrom(randomId('deal')));
  for (let i = deck.length - 1; i > 0; i -= 1) {   // Fisher-Yates
    const j = Math.floor(next() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return seats.map((seat, index) => ({ ...seat, role: deck[index] }));
}
```

测试注入 `randomId: () => 'fixed'` 即可复现同一副牌。**不需要扩展契约**。

> ⚠️ **不要用 `seatAgent({ role })` 存游戏身份。** `toActor()` 会把 `session.role` 放进 `actors()`，一旦 host 把 `actors()` 塞进 `visibility: 'channel'` 的快照就全场泄底。Agent 占座时 `role` 一律填中性值（如 `'player'`），真实身份只存在 host 自己的状态里。

---

## 4. 夜间结算

### 4.1 并发优化

物理桌上狼人和预言家必须分开睁眼，线上没有这个限制：**狼人与预言家并发行动**，女巫单独一阶段（她必须知道刀口）。夜晚时长大约减半。

预言家若当晚被刀，查验结果依然成立——他行动时还活着。

### 4.2 狼人刀人

三狼各自提名，队友实时可见，截止前可改。截止时多数决。

- **平票 → 空刀**（标准规则：无法统一意见视为空刀）
- 允许空刀、允许自刀
- 狼人私聊 `wolfChat` 只投给狼队友（`visibility: 'private'`，逐个 actor 发）

### 4.3 女巫

- 解药 ×1、毒药 ×1，**同夜不可双药**（`witchDoublePotion: false`）
- **仅首夜可自救**（`witchSelfSaveNight: 1`，9 人标准局规则）
- **解药用完后不再告知刀口**——`snapshot()` 里 `tonightKill` 变 `null`

### 4.4 结算顺序与「狼刀在先」

必须分段结算，**每段之后检查胜负**：

```
1. 狼刀命中（未被解药救）  → 检查胜负 ← 命中则狼胜，后续无效
2. 女巫毒杀                → 检查胜负
3. 猎人开枪                → 检查胜负
```

规则依据：狼人刀杀已达成胜利条件时直接判狼胜，**即使女巫随后毒死最后一只狼、或猎人开枪带走最后一只狼也无效**。

### 4.5 公布死讯

`dawn` 只公布**谁死了**，不公布**怎么死的**。死因只进死者自己的私密视图。

---

## 5. 胜负判定

```js
function checkVictory(state, board) {
  const alive = state.seats.filter((seat) => seat.alive);
  const wolves = alive.filter((seat) => seat.role === 'werewolf').length;
  const gods = alive.filter((seat) => GOD_ROLES.has(seat.role)).length;
  const villagers = alive.filter((seat) => seat.role === 'villager').length;

  if (wolves === 0) return { over: true, winner: 'good', reason: 'ALL_WOLVES_DEAD' };
  if (board.victory === 'edge') {
    if (gods === 0) return { over: true, winner: 'wolf', reason: 'GODS_WIPED' };
    if (villagers === 0) return { over: true, winner: 'wolf', reason: 'VILLAGERS_WIPED' };
  } else if (gods + villagers === 0) {
    return { over: true, winner: 'wolf', reason: 'TOWN_WIPED' };
  }
  if (wolves >= gods + villagers) return { over: true, winner: 'wolf', reason: 'UNSTOPPABLE' };
  return { over: false };
}
```

最后一条（狼数 ≥ 好人数）提前终局，避免无意义的走完流程。

---

## 6. 出局后禁止发言

**是，出局后禁止公开发言。** 由 host 在 `speak` 动作上强制：

```js
if (!seat || !seat.alive) return reject('WW_DEAD_CANNOT_SPEAK');
if (state.phase.currentSpeaker !== seat.id) return reject('WW_NOT_YOUR_TURN');
```

唯一例外是**遗言**（`last_words` / `exile_last_words`）：死者获得一个专属发言窗口，讲完即彻底禁言。

### 6.1 死者能看到什么

死者进入观战：**公开日志 + 自己的身份和记忆**，**不给上帝视角**。全部身份只在 `game_over` 揭晓。

理由有两层：一是同处一室的死者若能看到全部身份，会通过场外渠道泄露；二是这条约束让 `visibility.js` 的不变量保持单一——「任何时刻，任何人只能看到自己该看到的」，没有例外分支就没有漏洞。

死者私聊频道是 v2 的事。

### 6.2 typing 指示器必须收敛

`typing` 是频道级广播。若玩法页在夜晚照常发 `typing`，**女巫在纠结用药这件事会直接泄露**。

规则：玩法页**只在自己的发言回合**发 `typing`，其余阶段（含夜间全部操作、投票）一律不发。这由玩法页自己控制，不需要改契约。

---

## 7. 发言回合

满足「可以打字、没话说了直接结束」：

- `day_speech` 持有 `currentSpeaker`（座位 id）与 `deadline`
- 只有 `currentSpeaker` 能发 `speak` → host 返回 `post` 走公开消息
- **一个回合内可以发多条**（想到哪说到哪）
- `endSpeech` 主动结束 → 立刻轮到下一位
- 超时自动轮转
- 轮完全部存活者 → `day_vote`

起始发言人：首日由 `dealing` 时的 PRNG 决定，之后每天顺延一位（等价于线下「死左/死右」轮换），避免首发言位固定带来的优势。

`speak` 的文本走 `post` → `handleMessage`，因此**自动沿用现有的长度限制、频率限制与将来的内容审核**。玩法不自己造一套消息通道。

---

## 8. 投票

- 存活者各一票，可弃票（`abstain`）
- 超时未投 = 弃票
- 唱票公开：谁投了谁，全部公开（标准规则）
- **平票** → `pk_speech`（平票者依次发言）→ `pk_vote`（平票者本人不投）→ 仍平票则本轮无人出局
- 被放逐者有遗言

---

## 9. 猎人开枪

| 死因 | 能否开枪 |
| --- | --- |
| 被狼刀 | ✅ |
| 被投票放逐 | ✅ |
| **被女巫毒杀** | ❌ |

- 可以选择弃枪（`hunterPass`），超时视为弃枪
- 被带走者**没有遗言**
- 开枪后立即检查胜负

---

## 10. 遗言

只有两种情况有遗言：

1. **首夜死亡**（含被毒死）
2. **白天被放逐**

第 2 夜及以后夜里死亡的玩家无遗言。猎人带走的人无遗言。

首夜多人死亡时，按座位号顺序依次留遗言。

---

## 11. 目录结构

```text
plays/werewolf/
  play.json
  host.js                 # 编排：把 playAction 路由到 machine，产出 snapshots
  rules/
    boards.js             # 纯数据：板子定义
    deal.js               # 纯函数：洗牌发牌
    resolve.js            # 纯函数：夜间结算（分段 + 胜负检查）
    victory.js            # 纯函数：胜负判定
    ballot.js             # 纯函数：计票、平票 PK
  machine.js              # 阶段转换 + deadline（注入时钟）
  visibility.js           # ★ 唯一的对外投影：viewFor(state, actorId)
  agents/
    villager.js           # createPlayAgent spec（按角色分文件）
    werewolf.js
    seer.js
    witch.js
    hunter.js
  prompts/
    *.md                  # 角色提示词与规则知识
  page/
    index.html
    app.js
    style.css
  assets/
```

`host.js` 只做编排，不写规则。`rules/` 全部是纯函数，零 IO、零时钟依赖，可直接单测。

### 11.1 `visibility.js` 是安全核心

**所有发往客户端和 Agent 的状态，必须且只能经过 `viewFor()`。** 任何绕过它直接序列化内部 state 的代码路径都是泄底漏洞。

`host.snapshot(actor)` 与 Agent 的 `privateView` 走的是同一个函数（`src/play/runtime.js:172`），所以 **Agent 天然没有上帝视角**——这是架构保证，不是提示词约束。

必测的不变量：

- 狼队友 id 只出现在狼的 view
- 预言家查验结果只出现在预言家的 view
- 女巫看到的刀口不出现在任何其他 view
- 死者 view 不含他人身份，直到 `game_over`
- 任何 `visibility: 'channel'` 快照都不含 `role` 字段

---

## 12. 定时器

`runtime.schedule` 可用，`runtime.cancel` **未注入**（见 §13）。用**代际计数**替代取消：

```js
let generation = 0;
function enterPhase(next, ttlMs) {
  const mine = ++generation;
  state.phase = next;
  runtime.schedule(() => {
    if (mine !== generation) return;   // 阶段已推进，本次定时作废
    onDeadline(next);
  }, ttlMs);
}
```

全员提前行动完 → `enterPhase` 使 `generation` 自增 → 旧定时器回调自动失效。不需要 `cancel`。

---

## 13. 契约缺口（需在 Issue #2 报备）

### 13.1 🔴 阻塞：host 无法主动推送快照

`snapshots` 只能作为 `onAction` / `onJoin` 的返回值产生。`hostRuntime`（`src/play/runtime.js:100-133`）没有暴露 `onEffects`，因此**定时器到点推进阶段时，host 无法把新状态发给任何人**。

狼人杀每一个阶段都靠 deadline 推进（夜晚超时、发言超时、投票超时），这是**当前就需要**的能力，不是为未来预留。

建议最小改动：

```js
// hostRuntime 增加
emit(snapshots) { /* 复用 snapshotsFrom() + onEffects() 的现有路径 */ }
```

`requestTurn` 内部（`runtime.js:190-197`）已经跑通了这条路径，抽出来即可，不新增概念。

### 13.2 🟡 文档漂移：`runtime.cancel`

`docs/play.md` §6 的表格列了 `cancel`，但 `runtime.js:100-133` 实际没注入。§12 的代际计数可以绕开，但文档与实现应当对齐。

### 13.3 🟢 低优先：`message` 命令没有 host 闸门

`handleMessage`（`src/core/commands.js`）没有玩法钩子，所以死亡玩家绕过玩法页、直接发 `message` 命令仍能公开发言。

玩法页不提供这个入口，且 Pavilo 的威胁模型是「局域网内互相信任的小团队」，因此首版不处理。若将来要堵，属于 `src/core` 改动，需要单独立项。

---

## 14. 实现顺序

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| P0 | `rules/` 全部纯函数 + `visibility.js` | `node --test` 跑完整局；泄底测试全绿 |
| P1 | `machine.js` 阶段机（注入时钟，虚拟时间） | 超时、提前完成、代际失效都有测试 |
| P2 | `host.js` 编排 + 最小 `page/` | 三个浏览器标签页打完一局 9 人局 |
| P3 | `agents/` 各角色 spec | 1 人 + 8 Agent 自动打完一局 |
| P4 | 页面打磨、i18n、移动端 | 中英文案齐全，主操作可点 |

P0 完全符合测试金字塔第一层：纯函数、注入时钟、不启网络。**规则正确性与信息隔离这两个真正的难点，在 P0 结束时就应该全部钉死。**
