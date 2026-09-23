# 模块边界

> 状态：描述当前主线。网关、管理后台、人员治理、Play/Agent 宿主、功能目录、宿主身份、治理闭环和嵌入预览已发布。一段话接入见 [接入说明](../integrate.md)，不发布 SDK。提交前审核尚在规划。

本文档记录 Pavilo 当前架构的模块边界与职责划分。基础聊天采用结构化设计，默认内存模式不需要数据库，前端不依赖构建工具或框架；SQLite、网关与玩法按现有配置显式启用。配置默认值、Protocol v4、CSS 和页面 DOM 保持既有契约。详见 [聊天协议](chat-protocol.md)、[状态模型](state-model.md)。

## 客户端

`index.html` 保留页面结构、首屏恢复标记、资源引用与启动入口。`client/` 使用普通脚本；协议/连接/状态/pending/图片规则同时支持 CommonJS 导出，可直接由 Node 测试加载，不依赖 DOM。

| 模块 | 责任 |
|---|---|
| `protocol.js` | 命令/事件名称、字段约定和解析校验；不引入新的线上协议 |
| `connection.js` | WebSocket、join、恢复存储、退避重连、停服；通过订阅发出生命周期和 payload，不触碰 DOM |
| `state.js` | `createInitialState` / `reduce` / `createStore`；快照、频道、消息、typing、未读、pending 投影与连接状态 |
| `pending.js` | ACK 超时、accepted、失败、同 ID 对账、同 epoch 重试及草稿匹配；定时器可注入 |
| `images.js` | 可纯测的尺寸/质量/字节预算规则，以及可注入浏览器 API 的读取和 Canvas 处理 |
| `performance.js` | DOM 更新最小工具：`smartUpdate` 与 `shouldRebuildList` |
| `error-states.js` | 连接状态指示器、toast 与阻塞性错误覆盖层 |
| `i18n.js` | 轻量字典 + `{var}` 插值；`zh-CN` / `en`；选择写入 `localStorage` |
| `messages.js` | 权威与待确认消息显示、一次 payload 一次重建、DOM 修改前采样及阅读锚点恢复 |
| `composer.js` | 输入、IME、回复、typing、图片暂存（粘贴/选文件/拖放）与发送 |
| `overlays.js` | 成员资料、抽屉、popover、图片查看器和焦点管理 |
| `notifications.js` | toast、标题、favicon、系统通知；不修改权威消息数组 |
| `app.js` | 创建模块、绑定 DOM/用户意图与协议事件；跨模块副作用的组合点 |

`reduce(state, event)` 不做 IO。连接、时钟、当前阅读/聚焦条件作为明确输入；视图根据状态渲染。待确认项中的发送定时器属于 pending 管理器，不属于纯 reducer。

阅读位置不是 CSS 自动行为：修改 DOM 前采样，淘汰与追加合并处理，优先恢复消息锚点，锚点消失后按距底部距离回退。恢复期间临时禁用 smooth scroll，并保留 `overflow-anchor: none`。

## 服务端

`server.js` 加载配置、创建 core 和 transport，保留命令行启动与信号处理。导入模块不会监听端口或注册进程信号。

```js
const { createChatServer } = require('./server');
const app = createChatServer(options);
const address = await app.listen(0, '127.0.0.1');
app.state();
await app.stop();
```

兼容导出仍为 `createChatServer`、`DEFAULTS`、`PROTOCOL_VERSION`、`REACTION_EMOJIS`。工厂返回 `server/listen/stop/roomEpoch/localAddresses/config/state`，不要求现有调用者迁移。

### 存储 `src/storage`

内核只依赖 `ConversationStore` 端口，不 import SQLite 驱动。未注入 store 时，`createChatCore` 内部创建 memory 实现。当前默认驱动仍是进程内数组：重启即空。

- `index.js`：`createConversationStore(config, runtime)`，按 `config.storage.driver` 选择实现；省略则 memory。
- `memory-store.js`：每频道 epoch / 工作集 / seq / 字节数 / FIFO / 幂等窗口；FIFO 淘汰是真删除。
- `sqlite-store.js` / `sqlite-engine.js`：可选持久化；`cli.js` 提供 backup / restore / integrity / stats。

### 领域内核 `src/core`

- `room.js`：频道配置目录、默认频道校验、历史分块；会话状态委托给 ConversationStore。
- `session.js`：用户名规范化、恢复凭据、频道与全局容量、active/leased、昵称冲突、租约到期。
- `messages.js`：图片魔数/尺寸校验、消息公开字节、回复快照、指纹。
- `commands.js`：join/switchChannel/message/reaction/typing/leave 规则和限流；写入经 store。
- `events.js`：公开投影与私有路由 envelope。typing 标记为 transient；ACK/error 只发给对应连接。
- `index.js`：组合内核、逻辑 peer、命令 dispatch、同步完成、断线和关闭。时钟、ID、定时调度与 store 可注入。

内核没有 HTTP request 或 socket。peer 是内核内部的逻辑身份；其 `session.client` 只是逻辑 peer 引用，不是网络连接。内部 Map 不向传输层暴露。

```js
const core = createChatCore(config, runtime);
core.connect('peer-1', '127.0.0.1');
const result = core.dispatch('peer-1', command);
// { accepted, effects, error? }
```

`effects` 保持发生顺序：

- `send`：指定 peer 的 payload；
- `broadcast`：频道事件及事件发生时的接收 peer ID 列表；
- `initial`：指定 peer 的完整初始同步序列；
- `close`：指定 peer 的关闭 code/reason。

路由 envelope 仅在进程内部使用，不能原样发到浏览器。ACK 必须先于 message；接管产生的 typing 等事件必须按**发生时**的接收者路由，不能在状态改变后重新枚举。

`core.completeSync(peerId)` 由传输层在初始快照和同期直播队列都完成后调用。在此之前，内核继续拒绝普通命令并保留 `clientMessageId`。租约/typing 到期产生的 effects 通过注入的 `onEffects` 送到传输层；测试可注入虚拟时钟而完全不启动网络。

### 网关 `src/gateway` 与值班台 `src/operator`

可选。`server.js` 创建网关并注入 operator HTTP。`src/core` 不 import fetch 或厂商 SDK。

- `gateway/`：preset（DeepSeek / openai-compatible）、OpenAI 兼容 `complete()`、用量、SQLite 密文渠道。
- `operator/`：`/admin` 静态白名单与 JSON API；进程内 session；与聊天 WebSocket 隔离。
- 管理页在 `admin/`：语亭后台为壳，AI 网关为其中模块。房间与聊天频道默认真源是 YAML，管理页保存后以 SQLite 为准。未启用时 `/admin` 为 404。说明见 [admin.md](../admin.md)。

### 玩法 `src/play`

可选。`server.js` 加载 `plays/<id>/host.js` 并注入 core。`src/core` 只认识 `playAction` 信封，不 import 具体玩法。

- loader：trusted `require`，校验 `play.json` / `host.js` / `page/index.html`
- runtime：同步状态机 + 异步 Agent 回合（`onEffects`）
- `createPlayAgent(spec)`：`legalActions` 硬约束
- 记忆：内部有 memory/sqlite 实现；产品配置启用玩法要求 SQLite（`play_games` / `play_agent_memory`），不提供 memory 模式玩法开关
- HTTP：`/plays/<id>/` 只挂 `page/` 与 `assets/`
- 契约：[`docs/play.md`](../play.md)、ADR-0006

### 传输层 `src/transport`

- `http.js`：静态资源、`/room-info`、`/healthz`、MIME、gzip/ETag 和路径边界。只读取 core 的公开元数据/统计，不了解内部 Map。可选把网关公开摘要 merge 进 `/healthz`。
- `websocket.js`：upgrade、Origin、连接/每 IP 限制、写缓冲、初始同步队列、drain、心跳和生命周期。
- `protocol.js`：masked frame 校验、fragment、控制帧和 JSON 解码。只将命令交给 core，不裁决聊天业务。

`socket.write(false)` 表示已排队但背压，不能当发送失败重发。初始同步按 drain 推进；慢连接仍受原有字节和超时上限约束。

### 静态资源与配置隐私

`/client/` 不是目录挂载：只服务 `http.js` 显式列出的文件，GET/HEAD 共享 gzip、ETag 和 realpath 边界检查。未列出的客户端文件、`src/`、测试、配置与其余仓库源码仍为 404。

配置加载器保守保留整个 `client/`、`vendor/`、`admin/` 和 `plays/` 目录，拒绝其中配置文件及指向这些目录的符号链接，避免以后增加前端资源时暴露真实配置。YAML 版本、字段、默认值、加载优先级保持不变。

## 验证与后续范围

- `npm test`：现有配置/网络集成测试，加客户端纯模块、真实 core 输出到客户端解析器的契约测试、无网络领域测试。
- `npm run test:browser`：独立 Google Chrome/Playwright 双页面验收；Playwright 由仓库外安装提供，见 README。
- `npm run config:check` 与 `node --check`：配置和源码语法检查。

`test/browser/` 独立执行，不让默认 Node 测试隐式依赖浏览器。仓库已有 CI、Node 22/24/26 矩阵、Docker 和发布工作流；当前 Node 24/26 测试与浏览器 job 仍允许失败。v2.0 计划将支持版本矩阵与关键浏览器验收设为发布门槛，实际移动输入法、局域网、代理和容量验收需按发布记录说明，不以工作流存在代替结果。
