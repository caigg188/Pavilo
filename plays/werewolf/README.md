# 官方狼人杀（规划中，待实现）

Pavilo 的官方样例玩法。主线已经冻结 [Play 契约](../../docs/play.md) 与 [ADR-0006](../../docs/adr/0006-play-contract.md)。对照夹具：[`plays/echo/`](../echo/)。

本目录目前只有清单与开发说明，尚无可运行 host 和页面。官方狼人杀是完整 Play 参考，与基础设施并行开发；不作为 v1.7 一段话接入的门槛，v2.0 前必须交付。阶段见 [路线图](../../ROADMAP.md)。请在这里填实玩法本身，保留聊天页气泡和网关密钥边界。

官方合作开发者实现本玩法时，如果信封、host API 或 Agent 基座不够用，可以改主线契约（`src/play/`、`docs/play.md`、相关测试），但请先在跟踪 Issue 里写清缺口。不要为了「以后所有游戏」扩端口。

## 目录

```text
plays/werewolf/
  play.json          # 已有，id 必须是 werewolf
  host.js            # 确定性状态机（要写）
  agents/            # 用 createPlayAgent(spec)，不要直连模型
  prompts/
  page/index.html    # 独立玩法页
  page/app.js
  page/style.css
  assets/
  README.md
```

启用后地址：`/plays/werewolf/?channel=<频道 id>`。HTTP 只服务 `page/` 与 `assets/`。

## 必须做到

- Host 是状态机；LLM 不裁决规则。Agent 只能从 `legalActions` 里选。
- 人与 Agent 混编开局。Agent 占频道座位，不占 WebSocket 连接数。
- 私密信息（身份、预言、夜间行动）只走 `visibility: private` 的 `playState`。
- 公开发言走 `message` / `runtime` 返回的 `post`。
- 简体中文 + 英语；移动端主操作可点。
- 可捕获的玩法/Agent 失败不破坏普通聊天；模型失败和超时有可测试处理，不承诺恶意脚本的进程隔离。
- 完整对局、断线恢复及私密视图有验收；随宿主身份演进验证稳定用户与演员席位关系。
- 嵌入能力落地后，聊天与玩法切换留在主线提供的嵌入区域，不跳走宿主应用。
- 状态机测试：非法动作拒绝、局内记忆不泄漏到公开事件。

## 不要做

- 语音/视频、通用游戏引擎、规则 DSL、自造 iframe 加载平台或绕过网关直连模型 API。主线统一嵌入宿主属于产品基础设施，按其契约接入。
- 往 `chat.css` / `client/messages.js` 塞选人器。
- 社区贡献者不要在本目录的 PR 里改 `src/core`；官方合作开发者改契约时走 Issue 说明 + 测试。

## 验收时对照

`plays/echo/` 的 `echo` / `shout` / `summon` 路径，以及 `docs/play.md` 第 5–7 节的函数名。
