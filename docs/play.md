# Play 契约

本文是 v1.3.0 已发布的玩法贡献契约，不是宿主应用接入 SDK。已有契约按冻结约束兼容演进。背景见 [ADR-0006](adr/0006-play-contract.md)、[架构演进](evolution.md) 与 [路线图](../ROADMAP.md)；新增产品方向见 [ADR-0008](adr/0008-embeddable-composable-chat.md)。

> 聊天页是「没有玩法」的默认频道投影。玩法不是在气泡上打补丁。

官方狼人杀尚未实现；契约用仓库内的 `plays/echo/` 夹具跑通。默认配置不启用 echo。狼人杀与基础设施并行开发，不作为 v1.7 一段话接入的门槛，在 v2.0 前必须作为完整参考交付。

---

## 1. 产品模型

从管理员或用户看：**启用一套玩法模块，再把某个频道的 `play` 指过去**。进入该频道，加载该玩法自己的页面。聊天页仍是未绑定 `play` 的默认频道。

```yaml
version: 2

storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db

plays:
  - werewolf

channels:
  - id: general
    name: 大厅
    # 无 play → 现有聊天页
  - id: village
    name: 狼人杀
    play: werewolf   # 进入后打开 /plays/werewolf/?channel=village
```

同一玩法可以绑多个频道（多桌）：页面相同，`channel` 不同。

`channels[].play` 必须出现在 `plays` 里，否则启动失败。玩法需要 `storage.driver: sqlite`（对局与 Agent 记忆）。未启用任何玩法时，部署者看不到玩法页，启动成本不变。

默认频道建议保持普通聊天。若默认频道绑了玩法，登录后会跳到该玩法页。

---

## 2. 谁维护什么

| 能力 | 主线维护 | 玩法贡献者 |
| --- | --- | --- |
| 会话、Protocol v4、重连、离开 | 是 | 调用，不重写 |
| 频道列表切换（聊天页 ↔ 玩法页） | 是（薄宿主） | 不自己发明第二套房间系统 |
| `playAction` / `playState` 信封 | 是 | 填自己的 action 名与 payload |
| AI 网关、key、用量 | 是 | 只在服务端经 `runtime.complete()` 调用 |
| `createPlayAgent(spec)` 循环 | 是 | 导出 spec，不复制网关调用 |
| 规则状态机、提示词、合法动作 | 否 | 是 |
| 页面 DOM / CSS / 交互 | 否 | 是 |
| 静态资源目录与 URL 约定 | 是 | 按约定放文件 |

主线不提供组件库、不规定必须用哪套颜色。官方狼人杀可以选用现有设计 token，社区玩法可以完全自己画。

---

## 3. 目录

一个玩法的**全部**资产在 `plays/<playId>/`：页面、静态资源、状态机、提示词、Agent spec。不要把某个玩法的规则或 DOM 散落到 `src/`、`client/`、`chat.css`。

```text
plays/werewolf/
  play.json          # id 必须等于目录名
  host.js            # module.exports = { id, create(runtime) }
  agents/            # 可选
  prompts/           # 可选，仅 Node 读取
  page/
    index.html
    app.js
    style.css
  assets/            # 可选图片等
  README.md
```

- 页面地址：`/plays/<playId>/`，多桌用 `?channel=<channelId>`。
- `/plays/<playId>/assets/...` 映射到该玩法的 `assets/`。
- 其它 URL（含 `host.js`、`play.json`、`agents/`）为 404。
- 未启用的 playId 全部 404。
- 无会话时回到 `/` 登录；登录后的 session 与聊天页共用（`sessionStorage` 键 `pavilo.resume` / `pavilo.channel`）。
- 聊天页点到玩法频道 → 跳到玩法页。玩法页点到普通频道 → 先 `switchChannel` 再回 `/`。不要在聊天气泡流里硬渲染玩法。

---

## 4. 页面宿主

玩法页引入主线脚本，其余主区域归玩法：

```html
<script src="/client/protocol.js"></script>
<script src="/client/connection.js"></script>
<script src="/client/play.js"></script>
<script src="./app.js"></script>
```

`PaviloPlay.createPlayClient()` 提供：

| 方法 | 作用 |
| --- | --- |
| `start({ channelId })` | 恢复会话或跳去登录；join 后如有必要 `switchChannel` |
| `playAction(name, payload)` | 发送 `playAction`，返回 `clientActionId` 或 `null` |
| `subscribe(listener)` | 收到已解析的服务端事件（含 `playState`、`message`、`presence`） |
| `switchToChannel(channel)` | 聊天频道：切换后回 `/`；玩法频道：跳对应 `/plays/<id>/` |
| `leave()` | `leave` 命令并清会话 |

不强制使用 `chat.css` 或 `messages.js`。

---

## 5. 协议

同一条 WebSocket、同一个 Protocol v4。不为每个玩法开一版协议。

### 5.1 `playAction`

```json
{
  "type": "playAction",
  "clientActionId": "与 clientMessageId 同形，8–96 位 [A-Za-z0-9_-]",
  "name": "vote",
  "payload": {}
}
```

- `name`：`/^[a-z][a-zA-Z0-9_]{0,63}$/`
- `payload`：对象，可省略（视为 `{}`）；JSON 字节受频道 `maxJsonBytes` 约束
- 当前频道无 `play` → `PLAY_NOT_BOUND`
- host 拒绝 → `PLAY_ACTION_REJECTED`
- 同步中 → `SYNC_IN_PROGRESS`（回传 `clientActionId`）
- 幂等键：`channelId + session.token + clientActionId`
- 限流：独立 bucket，阈值同 `rateLimits.messages`

### 5.2 `playState`

```json
{
  "type": "playState",
  "playId": "werewolf",
  "channelId": "village",
  "gameId": "g_...",
  "seq": 3,
  "visibility": "private",
  "state": {},
  "clientActionId": "可选，对应发起者的 playAction"
}
```

- `visibility: private`：只发给当事 peer
- `visibility: channel`：当前频道在席 **human** peer
- `state` 由该玩法自定；主线只限制字节
- 私密信息不得放进 `visibility: channel`

### 5.3 加入快照

当前频道绑定了玩法时：

- `stateStart.capabilities` 含 `play`
- `stateStart.play` 为 `{ "id": "werewolf", "page": "/plays/werewolf/" }`
- 初始同步在 `historyEnd` 之后可跟一条对该 actor 的 private `playState`

`/room-info.channels[]` 增加可选 `play`（playId）。

公开发言走现有 `message`，以便沿用长度、频率和将来的审核。

---

## 6. Host API

`plays/<id>/host.js`：

```js
module.exports = {
  id: 'werewolf',
  create(runtime) {
    return {
      onJoin(actor) {
        return { ok: true, snapshots: [/* 可选 */] };
      },
      onLeave(actor) {},
      onAction(actor, { name, payload, clientActionId }) {
        return { ok: true, snapshots, post };
        // 或 { ok: false, code: 'PLAY_ACTION_REJECTED', message }
      },
      snapshot(actor) {
        return { /* 该 actor 的私密 view，放入 playState.state */ };
      }
    };
  }
};
```

`runtime`（主线注入，host 不得 `require('../src/storage')`）：

| 成员 | 作用 |
| --- | --- |
| `now()` / `randomId()` / `schedule` | 可注入。没有 `cancel`：定时器请用代际计数自检失效 |
| `channel` | `{ id, playId }` |
| `actors()` | 当前桌 human + agent |
| `seatAgent({ username, spec, role })` | 占座；失败返回 `{ error }` |
| `requestTurn(actor, { legalActions })` | 异步 Agent 回合 |
| `emit(snapshots)` | 主动推送快照，用于 deadline 驱动的阶段推进；返回送出条数 |
| `post(actorId, text)` | 以某个 **agent** 座位的身份公开发言；human 请用 `onAction` 的 `post` 返回值 |
| `complete(req)` | `gateway.complete` 的包装；未启用时 `{ ok: false, code: 'GATEWAY_DISABLED' }` |
| `memory.read/append/clear(actorId)` | 局内记忆 |
| `load()` / `save(state)` | 不透明对局 blob |
| `gameId` | 当前局 id |

`onAction` 可返回：

- `snapshots`：`{ visibility: 'private'|'channel', actorId?, state }`
- `post: { text }`：以该 actor 的身份发一条公开文字消息（走 Command API）

`emit()` 与 `post()` 面向「没有 `onAction` 可搭便车」的场景：阶段靠 deadline
推进时，host 必须能主动把新状态发出去；Agent 回合结束时，它的发言也要落到频道里。
Agent 占座但没有 peer，因此 `post()` 不产生 ack，失败时只返回 `{ ok: false, code }`，
不会中断对局。两者在 host 已故障时都是空操作。

`emit()` 里 `visibility: 'private'` 的快照**必须自带 `actorId`**：没有发起者可以回落。

Host 出现可捕获异常：该频道玩法标记故障，后续 `playAction` 返回 `PLAY_HOST_FAILED`；其它频道与普通聊天不受该失败路径影响。这不隔离无限循环、`process.exit` 或其它进程级故障，玩法仍是可信代码。

Actor 形状：`{ id, username, kind: 'human'|'agent', role?, channelId }`。Agent 占频道座位，不占 WebSocket 连接数。

---

## 7. Agent 基座

```js
const { createPlayAgent } = require('../../src/play/agent');

module.exports = createPlayAgent({
  role: 'seer',
  timeoutMs: 20_000,
  maxTokens: 400,
  system(ctx) { return '…'; },
  view(ctx) { return ctx.privateView; },
  schema(ctx) { return ctx.legalActions; },
  parse(text, ctx) { /* 可选，默认抽 JSON */ },
  onInvalid(ctx, err) { return { name: 'skip', payload: {} }; }
});
```

循环：拼 prompt → `complete()` → 解析 → **必须落在 `legalActions` 内** → `host.onAction` → 写入该 actor 的局内记忆。

`legalActions` 是 `{ name, payload? }[]`。带 `payload` 的项要求深相等；只带 `name` 的项允许任意 payload。`skip` 由基座放行，host 应视为空操作。

无 sqlite / 无 operator / 无渠道时不要 throw；`complete()` 返回失败码即可。

---

## 8. 安全

- 浏览器**禁止**直连 AI 网关。
- `playAction` 仍是 Protocol v4 命令：transport → core 分发给该频道 host。
- 玩法页是 trusted code：只加载管理员启用的目录。
- 对局与 Agent 记忆不进 `/room-info`。结束或 `clear` 一局时删除该 `gameId` 的记忆。

---

## 9. 官方仓库额外要求

自己实例加载的玩法可以更自由。要进主仓库，还需要：

- 简体中文 + 英语文案；
- 移动端可用（主操作可点，不依赖纯 hover）；
- 玩法或 Agent 失败时，普通聊天频道仍可用；
- 有状态机测试：非法动作拒绝、局内记忆不泄漏到公开事件；
- 不改 `src/core`、不改网关、不往 `chat.css` 塞按钮。契约不够用先开 Issue。

对照实现：[`plays/echo/`](../plays/echo/)。

---

## 10. 现在不要做的

- 不要在 `chat.css` / `client/messages.js` 上堆玩法按钮；
- 不要做玩法商店、iframe 市场、前端框架强制；
- 不要做通用组件平台或规则 DSL；
- 不要为尚未存在的玩法预留主题引擎；
- 不要把 echo 当成给最终用户的游戏。


## 11. 面向 v2.0 的贡献方向（规划中）

当前独立玩法页、Protocol v4 和本页函数仍是实现依据。未来嵌入宿主将让聊天与玩法在同一嵌入区域切换，不跳走宿主页面；这不要求把玩法 UI 搬入聊天气泡，也不是玩法 iframe 市场。

身份演进需验证稳定宿主用户与临时演员席位的关系、断线恢复、身份切换和私密视图；不要仅凭昵称恢复局内身份。公开发言继续使用主线命令路径。宿主身份已随 v1.4 发布；人和 Agent 的公开消息接受同一套权限、限额，以及 v1.5 的墓碑移除和稳定用户拒绝。提交前审核尚未实现，勿据此调用虚构 API。

新增真实缺口先在 Issue 说明并补契约测试；不能把已冻结的函数当作任意可破坏的内部代码。v2.0 的整体接入与扩展稳定化不重置既有兼容承诺。完整范围见 [集成设计](integration.md)。
