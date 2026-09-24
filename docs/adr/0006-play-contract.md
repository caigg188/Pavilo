# ADR-0006: Play 契约（频道绑定、独立玩法页、Agent 基座）

## Status

已接受（2026-09-20）；Play 宿主已随 v1.3.0 发布。官方狼人杀仍由协作者并行。

2026-09-22 补充：下文把「v1.5 用狼人杀跑通」和「内容审核算 v1.4」写成当时的背景，不再是施工顺序。现行顺序以路线图为准：治理闭环是 v1.5，嵌入预览是 v1.6，一段话接入是 v1.7，提交前文本规则在其后，狼人杀由协作者并行、在 v2.0 冻结前完成。频道绑定、独立玩法页与现有契约继续有效。

## Context

v1.5 要用一个真实玩法（官方文字狼人杀）把贡献面跑通。已有草案见 `docs/play.md`（v1.0）与 ROADMAP v1.5。

约束：

- Protocol v4 在整个 v1.x 保持稳定（ADR-0001）。新能力走可选命令/事件与 `capabilities`。
- 扩展是可信脚本，不是沙箱（ADR-0003）。玩法 host 同一模型。
- 模型调用只走进程内网关（ADR-0005）。浏览器禁止直连。
- `src/core` 不认识具体游戏规则，不 import `plays/*`。
- 不为「以后所有 Agent 游戏」发明引擎、DSL、组件平台或商店。
- 内容审核（v1.4）不阻塞本期；公开发言仍走现有 `message`，审核落地后自动覆盖。

需要同时回答三个产品问题：

1. 进入绑了玩法的频道时，用户看到什么页面？
2. 浏览器如何提交结构化动作，私密结果如何只回当事者？
3. 玩法里的 Agent 如何复用同一套「观察 → 思考 → 行动 → 记忆」循环，而不是每个玩法自造 LLM 调用？

## Decision

### 频道即玩法，页面独立

管理员启用 `plays: [werewolf]`，再把某个频道的 `play` 指过去。进入该频道，打开 `/plays/<playId>/?channel=<channelId>`。聊天页只是未绑定 `play` 的默认投影。

同一玩法可绑多桌。未配置 `plays` 时行为与现在完全一致。

### 一个玩法一个目录

```text
plays/<playId>/
  play.json     # 清单
  host.js       # 服务端确定性状态机
  agents/       # 可选，组合主线 Agent 基座
  prompts/      # 可选，仅服务端
  page/         # 浏览器文档
  assets/       # 静态资源
```

HTTP **只**服务该玩法的 `page/` 与 `assets/`。`host.js`、`agents/`、`prompts/`、`play.json` 不进浏览器。

主线脚本（`client/protocol.js`、`connection.js`、`play.js`）不是玩法资产；玩法页用 `<script src="/client/...">` 引入。

### 协议：v4 信封，不升 v5

- 命令 `playAction`：`{ type, clientActionId, name, payload }`
- 事件 `playState`：`{ type, playId, channelId, gameId, seq, visibility, state }`
- `visibility: private` 只 `send` 给当事 peer；`channel` 广播给当前频道在席人类
- `stateStart.capabilities` 仅在**当前频道**绑定玩法时含 `play`
- `stateStart.play`：`{ id, page }`
- `/room-info.channels[].play` 可选

Host 是同步确定性状态机。LLM 不裁决规则。Agent 回合异步，经 `onEffects` 投递，与现有 timer 同构。

Host 不能直写 Store、不能碰 socket。公开消息走 Command API（现有 `message`）。

### Agent 基座：工厂 + spec，不是 class 继承

主线提供 `createPlayAgent(spec)`。玩法在 `plays/<id>/agents/` 导出 spec（`system` / `view` / `schema` / 可选 `parse`）。

硬约束：

- 人与 Agent 都是 Actor，进入同一桌 roster。Agent 占 `channels[].maxUsers`，不占 WebSocket `maxClients`
- host 给出 `legalActions`；模型输出必须落在其中，否则 skip
- 记忆作用域为「这一局 + 这个 actor」，sqlite 用独立表，不是聊天消息表
- 网关失败 / 超时 / 解析失败 → 该 Actor 本回合 skip，不崩频道、不崩聊天
- 无网关时人仍可玩（若该玩法允许）；创建 Agent 返回明确错误

### Config Schema：并入 v2（sqlite 家族）

根键 `plays` 与 `channels[].play` 写在 `version: 2`（sqlite 世界）。`version: 1` 禁止这些字段。非空 `plays` 必须 `storage.driver: sqlite`。不另开 Config Schema v4。默认 example 不启用任何玩法。

### 官方狼人杀不在本 ADR 的实现范围

本决策冻结宿主与信封。官方狼人杀按同一契约在 `plays/werewolf/` 由后续贡献实现。仓库用 `plays/echo/` 作为默认可加载夹具，验证契约；默认配置不启用它。

## Alternatives

### 方案 A：在聊天页插槽里堆玩法 UI

狼人杀需要选人、阶段、身份私密区，和气泡流不是同一种界面。玩法 CSS 会污染聊天页。不选。

### 方案 B：每个玩法一版协议 / 独立 WebSocket

破坏 ADR-0001，会话与重连要重做。不选。

### 方案 C：通用游戏引擎 + 规则 DSL + 组件平台

没有第二个玩法之前就是过度设计，违反 No Premature Generalization。不选。

### 方案 D：Agent 用 class 继承树（`Seer extends BaseAgent`）

Java 式继承会把角色规则吸进主线。spec 对象 + 工厂更符合现有可信脚本风格，玩法目录仍然拥有提示词和合法动作。

## Consequences

### 好的影响

- 贡献者有明确目录和函数名，不必先读完 `src/core`
- 聊天与玩法故障域分开
- Agent 成为可抄的开源特色，而不是每个玩法私自 `fetch` 模型

### 坏的影响 / 权衡

- Config Schema 增加到 v4；旧文件不能写 `play` 字段（故意）
- 从聊天页进玩法页是整页跳转，不能在气泡里「顺便玩一把」
- echo 夹具进仓库，文档必须写清「不是产品」

### 未来工作

- 官方狼人杀：`plays/werewolf/`
- 若第二个玩法证明信封不够，再扩端口，不预留
- v1.4 审核覆盖玩法频道的公开 `message`
