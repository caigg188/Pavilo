# Changelog

Pavilo 的重要变更都记在这份文件里。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 一段话接入，不发布 SDK。见 [接入说明](docs/integrate.md)
- `embed.direct`：只开顶层 `/embed`，仍然拒绝被 iframe。给 App 的 WebView。不写时行为与 v1.6.0 相同。小程序不在这次范围内
- `/embed` 和嵌入中的玩法页从地址 fragment `#pavilo=<jwt>` 读入凭证，并立刻从地址栏删除。`?pavilo=` 不算凭证。网页 iframe 的 `postMessage` 不变
- 嵌入页在凭证过期后再发一次 `hello`，外层按原来的回复换一张新凭证，不必拆掉 iframe
- [examples/alongside/](examples/alongside/)：在自己的网站旁边启动、并允许嵌入的配置
- [examples/host-embed/frame.js](examples/host-embed/frame.js)：逐字使用的嵌页代码

## [1.6.0] - 2026-09-23

嵌入预览。不写 `embed.ancestors` 时没有 `/embed`，页面仍拒绝被嵌，行为与 v1.5.0 相同。Protocol v4 不升号。不是 npm SDK，也不是原生或小程序插件。官方狼人杀尚未实现。

### Added
- `embed.ancestors`：只对这些源放开 `/embed` 和已启用玩法页的 `frame-ancestors`。省略时 `/embed` 为 404，`/` 与 `/admin` 仍是 `X-Frame-Options: DENY`。[v1.6 设计](docs/v1.6-design.md)
- 宿主模式：`/embed` 不读 `sessionStorage`，凭证经 `postMessage` 进入，不放进 URL。玩法往返停在同一个 iframe，离开玩法回到 `/embed`
- [`examples/host-embed/`](examples/host-embed/)：宿主页面只嵌 iframe，不自己开 WebSocket
- 浏览器验收改为阻塞发布。Node 24/26 仍允许失败

### Tests
- 2026-09-23 发布验证（本机 Node v26.5.0）：`npm test` 426 个，425 通过、1 跳过（`SYNC_IN_PROGRESS` 集成窗口）；`npm run test:browser` 20 通过；`npm audit --audit-level=high` 无漏洞。未在本机跑 Node 22/24。浏览器检查从本版起挡住发布。源码镜像未配置嵌入时 `/healthz` 为 200、`/embed` 为 404、`/` 为 `X-Frame-Options: DENY`，镜像内含玩法页面。GHCR 由标签工作流构建，发布前未拉取远端镜像

## [1.5.0] - 2026-09-23

治理闭环。默认 memory 仍无值班台、无举报库。不写 `userDenyList` 时，行为与 v1.4.0 相同。Protocol v4 不升号。不做嵌入，也不做提交前审核。官方狼人杀尚未实现。

从 v1.4 升级会在启动 SQLite 时自动执行 migration 006。回滚到 v1.4 要用升级前的备份恢复，不要把已经跑过 006 的库交给旧进程。

### Added
- 值班台图表：用量页用平滑曲线看近 7 日 tokens（左轴），用柱看请求（右轴），停在某一天看失败和渠道；两条及以上渠道再加横向条形图。总览在有记录时只画 token 折线
- 墓碑式移除：正文、图片和引用预览不再发给客户端；在线客户端收到 `messageRemoved`。[ADR-0011](docs/adr/0011-governance-loop.md)
- `report`：有值班台时可以举报。同一席对同一条未处理举报不重复入库。没有值班台返回 `GOVERNANCE_UNAVAILABLE`
- `moderation.userDenyList`：稳定用户拒绝名单，和 IP 黑名单同一段。命中后 `USER_DENIED`，关闭码 `4011 / user_denied`。Schema v1 只能写这份名单
- SQLite migration 006：`reports`、`operator_actions`
- 值班台人员页：待处理举报、身份拒绝名单、最近操作记录。席位发言可以移除

### Fixed
- 人员页「这一席留在库里的发言」在未传分页时间时不再被当成 `beforeCreatedAt: 0`，有发言时能列出来
- 发言记录、举报和用量改用同一张记录表
- 官方镜像补上 `admin/`。此前容器里即使配了 operator token，`/admin` 也找不到页面

### Tests
- 2026-09-23 发布验证（本机 Node v26.5.0）：`npm test` 421 个，420 通过、1 跳过（`SYNC_IN_PROGRESS` 集成窗口；`better-sqlite3` 已安装并计入通过）；`npm run test:browser` 19 通过；`npm audit --audit-level=high` 无漏洞。两份示例配置由 `test/config-example.test.js` 解析通过。只含 migration 001–005 的库打开后补上 006。源码镜像本地启停：默认内存模式 `/healthz` 为 200、`/admin` 为 404；挂上 sqlite 与 operator token 后 `/admin` 为 200。未在本机跑 Node 22/24。GHCR 由标签工作流构建，发布前未拉取远端镜像

## [1.4.0] - 2026-09-21

功能目录与宿主身份。默认 memory 仍全开、无账号。Protocol v4 不升号。官方狼人杀尚未实现。值班台不提供 `features` / `access` / 身份密钥的编辑页。

### Added
- 频道 `features`（`images` / `replies` / `reactions` / `mentions` / `typing` / `history`）与 `access`（`open` | `authenticated`）。省略等于全开、`open`。[ADR-0009](docs/adr/0009-feature-catalog.md)
- `stateStart.features`；关掉的功能从 `capabilities` 数组拿掉；绕过 UI 返回 `FEATURE_DISABLED`
- `join.identityToken`：宿主签发的 HS256 JWT；稳定用户 `userKey`；频道授权。[ADR-0010](docs/adr/0010-host-identity.md)
- 错误码 `IDENTITY_REQUIRED` / `IDENTITY_INVALID` / `IDENTITY_EXPIRED` / `CHANNEL_FORBIDDEN`；过期关闭 `4010 / identity_expired`
- [`examples/host-identity/`](examples/host-identity/)：最小宿主登录签发 JWT 并加入预建频道

### Changed
- `/room-info` 对未认证请求只列出 `access: open` 的频道，并带 `{ identity: { guests } }`，不含密钥
- Play 演员键：有宿主 `userKey` 时用 `sub`，否则仍用 `session.id`
- 人员页只读显示席位是否有 `userKey`；禁言/请离仍针对这一席
- 可复制示例收成两份：[`pavilo.example.yaml`](pavilo.example.yaml)（内存）、[`pavilo.sqlite.example.yaml`](pavilo.sqlite.example.yaml)（SQLite 家族）。玩法和宿主身份改为 sqlite 示例里的可选注释块

### Tests
- 2026-09-21 发布验证：`npm test` 395 个 Node 测试，393 通过、2 跳过（`SYNC_IN_PROGRESS` 集成窗口、未安装 `better-sqlite3`）；`npm run test:browser` 19 通过

## [1.3.0] - 2026-09-21

进程内 AI 网关、Play 宿主与 Agent 基座。配置对外仍是两种部署：`version: 1` 内存、`version: 2` SQLite 家族。默认关闭。聊天核心不依赖 AI 或玩法。内容审核不阻塞本期；后续阶段按更新后的路线图推进。官方狼人杀尚未实现。

### Added
- Config Schema v2 放宽：sqlite 家族可写 `operator` 与 `plays`（不另开 v3/v4）。v1 继续合法
- sqlite 示例增加 `operator.token`（`openssl rand -hex 32`）；模型渠道只在 `/admin` 配置，不另提供网关 YAML
- ADR-0004（配置双源；SQLite 中的渠道 key 为 AES-256-GCM 密文）与 ADR-0005（进程内网关）
- `src/gateway/`：OpenAI 兼容 `complete()`、DeepSeek / openai-compatible preset、超时重试并发闸
- SQLite migration 002：`gateway_channels` / `gateway_usage`；管理页写入的 API key 为 AES-256-GCM 密文
- 网关 hang 时聊天 message 仍 ACK；`/healthz` 在网关启用时附加 `{ enabled, channels, degraded }`，不含密钥
- `/admin`：operator token 登录、渠道编辑、密钥只写/掩码、连通性探测、近 7 日用量
- [`docs/gateway.md`](docs/gateway.md)：密钥红线、`complete()` 给 Play/Agent 与后续审核的调用口
- [`docs/admin.md`](docs/admin.md)：语亭管理后台为壳、AI 网关为模块
- ADR-0007：房间与聊天频道按段认领；默认跟 YAML，管理页保存后 SQLite 为准
- SQLite migration 004：`operator_config`（`room` / `channels` JSON 覆盖层）
- `/admin` 房间页与聊天频道页：保存后立即生效，可恢复为配置文件；已打开聊天页需刷新
- 可选 `plays` 与 `channels[].play`（`version: 2` + sqlite）。内存配置写这些字段会拒绝
- ADR-0006：Play 契约（独立玩法页、`playAction` / `playState`、Agent 基座）
- `src/play/`：trusted loader、同步 host、异步 Agent 回合、局内记忆（memory 或 sqlite migration 003）
- Protocol v4 可选能力 `play`：命令 `playAction`、事件 `playState`；仅当前频道绑了玩法时出现
- `/plays/<id>/` 只服务该玩法的 `page/` 与 `assets/`；`host.js` 与 `agents/` 为 404
- `client/play.js` 玩法页宿主（不进聊天页）；聊天页点玩法频道会整页跳转
- `createPlayAgent(spec)`：合法动作硬约束，模型不能越权
- [`plays/echo/`](plays/echo/) 契约夹具（默认不启用）；[`pavilo.plays.example.yaml`](pavilo.plays.example.yaml)
- [`plays/werewolf/README.md`](plays/werewolf/README.md) 官方样例目录约定（规划中，待实现）
- 冻结后的 [`docs/play.md`](docs/play.md)
- `/admin` 人员页：当前席位账本、禁言、请离；可选把该席 IP 写入黑名单
- SQLite migration 005：`operator_config` 增加 `moderation` 段（`ipDenyList`）；YAML `moderation.ipDenyList` 在 Schema v2 可用，管理页保存后认领该段
- Play host 可主动 `emit` / `post`；Agent 公开发言走现有 `message` 路径，不能绕过频道只读与限额
- [`docs/v1.3-closeout.md`](docs/v1.3-closeout.md)：v1.3 收口工作文档

### Fixed
- `/admin` 房间和聊天频道打开时带出当前有效配置；`/admin/api/pavilion` 失败时不再显示空白表，也不再把 404 正文当成空目录
- `/admin` 标签页补上与聊天页相同的 Pavilo favicon；此前管理页没有 `<link rel="icon">`，浏览器会落到返回 204 的 `/favicon.ico`

### Changed
- `version: 1` 出现 `storage` / `operator` / `plays` 会拒绝；memory 下的 v2 写 `operator`/`plays` 会拒绝。任何版本出现 `gateway:` 都会被拒绝。`version: 3` 当作 v2 读入。模型渠道只在 `/admin` 写入 SQLite
- sqlite 引擎由 composition 打开一次，聊天 store 与网关 store 共享连接
- `/admin` 房间 / 聊天频道不再是预留页；`config:check` 与启动横幅标明每段真源
- `/admin` 改为账本式布局：人员按频道分列，总览展示运行与存储
- 聊天输入框聚焦改为克制的呼吸光晕
- 内容审核不挡 Play 宿主开工；玩法公开发言仍走现有 `message`
- 更新产品与规划文档：独立聊天室与可嵌入聊天能力共用主线；v1.3–v2.0 按组装、宿主身份、嵌入与治理推进，官方狼人杀并行开发。新增集成设计和 ADR-0008；本次不实现未来功能或修改版本
- 对齐剩余入口与贡献材料：口号、包描述、项目结构、贡献/审查清单、Issue/PR 模板，以及网关、状态模型和测试策略中的版本状态

### Tests
- 2026-09-21 收口验证：`npm test` 381 个 Node 测试，379 通过、2 跳过（`SYNC_IN_PROGRESS` 集成窗口、未安装 `better-sqlite3`）；`npm run test:browser` 19 通过

## [1.2.0] - 2026-09-20

SQLite 运维：历史分页、备份/恢复、完整性检查与 healthz 库存字段。默认 memory 行为不变。不做全文搜索。

### Added
- 可选协议能力 `historyPage`：`historyPage` 命令 + `history` 分块 + `historyPageEnd`；滚到顶加载更早消息并保住阅读锚点
- 对已分页出工作集的消息，回复/回应走 `getMessage`，不再只因不在工作集而 `MESSAGE_GONE`
- `npm run storage -- backup|restore|integrity|stats`（restore 默认拒绝覆盖，需 `--force`；请先停服）
- sqlite 时 `/healthz` 追加 `storage: { driver, path, bytes, messages }`（全库条数）；顶层 `messages` 对 sqlite 也是全库条数，`roomBytes` 仍为工作集
- 过期删除分批（每批 500 行），批次之间让出事件循环

### Tests
- 总测试数：324 个（322 通过，2 跳过）

## [1.1.0] - 2026-09-20

可选 SQLite 持久化：默认仍是 memory，旧的 `version: 1` 配置继续合法。Protocol v4 不变。

### Added
- 内部 `ConversationStore` 端口；默认 memory，显式 `storage.driver: sqlite` 后重启仍在
- Config Schema v2：`storage.driver`、`sqlite.path` / `engine` / `retentionDays`（省略=30；永久用 `null` 或 `forever`；禁止 `0`）
- SQLite 双引擎：Node 22.5+ 用 `node:sqlite`，否则 optional `better-sqlite3`
- 启动时与每小时按 `retentionDays` 删除过期消息；ACK 只在事务提交后发出
- 两份可复制示例：[`pavilo.example.yaml`](pavilo.example.yaml)（内存）、[`pavilo.sqlite.example.yaml`](pavilo.sqlite.example.yaml)（留存）
- `/room-info.ephemeral` 随驱动变化；sqlite 另有 `retentionDays`；侧栏中英文案改为「记录会留下」
- 启动 banner：`Storage mode: memory` 或 `sqlite (engine=…, path=…, retentionDays=…)`
- 写入失败返回 `STORAGE_UNAVAILABLE`，不 ACK、不广播

### Changed
- `src/core` 经 store 端口读写会话数据，不 import SQLite 驱动
- YAML 删除频道不会 DROP 库里的旧行；FIFO 只踢出工作集

### Tests
- 总测试数：318 个（316 通过，2 跳过：原有 `SYNC_IN_PROGRESS` 集成窗口；`better-sqlite3` 未安装）

## [1.0.0] - 2026-09-20

第一个稳定版本（**Ephemeral Stable**）：默认无数据库、浏览器即用的自托管网页聊天。Protocol v4 与 Config Schema v1 在整个 v1.x 按文档承诺兼容。

本版本**不包含** SQLite、AI 网关、内容审核、官方玩法；那些是 v1.1 起的可选能力，不是 v1.0 没做完。

### Added
- [docs/play.md](docs/play.md)：后续玩法贡献的约束草案（本版本运行时不加载玩法页）

### Changed
- 产品从 Release Candidate 进入稳定；README / SECURITY / 发布流程去掉 Alpha / 观察期口径
- 更新 v1.x 规划：可选 SQLite（默认留存 30 天）、进程内 AI 网关与管理页、内容审核、独立玩法页与官方狼人杀样例
- GHCR：v1.x 标签打 `latest`、`1.0.0`、`1.0`、`1`；v0.x 标签不打 `latest` 与主版本 `1`
- GitHub Release 对 v1.x 标记为 stable（非 pre-release）

## [0.9.0] - 2026-09-18

### Removed
- **BREAKING: Protocol v1/v2/v3**。服务端只接受 `join.protocolVersion: 4`（必须为整数 4）。其他值返回 `PROTOCOL_NOT_SUPPORTED`，并以 WebSocket `1002 / protocol not supported` 关闭。请刷新内置网页客户端，或把第三方客户端升级到 v4。

### Added
- **图片先暂存再发送**：粘贴、选文件或拖入图片后，输入框内文字上方出现缩略图，可预览、删除，再点发送
- 图片消息可带可选配文与 `@` 提及，图和字显示在同一条气泡里（上图下字）
- GHCR 镜像发布 workflow（SemVer 标签含 `0.9.0`、`0.9`、`latest`；`1` 留给 v1.0）
- Release Checklist（`docs/version-management.md`）
- README 产品截图（登录、桌面聊天、移动端）

### Fixed
- 登录成功后先移走用户名框焦点，再给登录层加 `aria-hidden`，避免 Chrome 报 Blocked aria-hidden
- CHANGELOG v0.2.0 曾写「Paste from clipboard / Drag-and-drop」，当时并未落地；现已实现
- 图文混排仍上图下字，气泡按每张缩略图自己的显示宽度收紧（宽图宽、竖图窄），回复和回应按钮贴回气泡右侧
- 房间重启后的 pending 错误改走 i18n，不再写死中文

### Changed
- `/room-info.deprecatedProtocols` 改为 `[]`（字段保留）
- 纯 emoji 消息不再带气泡背景（与纯图片一致）；含文字时才显示气泡。混排时内联 emoji 略放大并对齐文字基线
- 聊天首页字号收成 caption 11 / label 12 / ui 13 / body 15 / title 22，去掉 9px 辅助文字；消息与输入框统一 15px
- 顶栏与频道头合并：当前频道名和连接状态进顶栏，重复的「临时/可信」文案只留左侧「只在此刻」卡片
- 1180px 以下先收成员栏、保留频道列表；成员改走抽屉。离开按钮改为幽灵/危险样式
- 输入区抬成主操作：发送按钮 40px（移动端 44px），登录卡补上亭标，空状态引导去输入框
- 附件按钮不再立刻发图；发送按钮在有待发图片或文字时可用
- 待发图片缩略图改到输入框内部、只占图片本身的宽度；删除叉在桌面悬停显示、手机常显
- 表情、提及、附加和发送按钮改到输入框右下角，左侧留给文字和图片
- 输入时高亮整个输入框（含图片和按钮），激活色从橙色改为青绿
- 表情面板右缘贴齐聊天列，避免按钮右移后面板探出输入区
- 消息改为独立气泡：同一人连续发言只在第一条显示头像，回复和表情按钮悬停出现在气泡右侧顶部
- 回应表情改到气泡内部底部，只显示 emoji 和数量
- 只读频道收起输入框，改为状态条
- GitHub Release 在测试失败时不再创建

### Tests
- 总测试数：286 个（285 通过，1 跳过）

## [0.8.0] - 2026-09-17

### Added
- **轻量 i18n**：无构建步骤的纯 JS 字典 + `{var}` 插值（`client/i18n.js`）
- 简体中文与英语界面，顶栏语言切换；选择写入 `localStorage`（`pavilo.language`）
- 配置项 `room.defaultLanguage`（仅 `zh-CN` / `en`），`/room-info` 公开 `defaultLanguage` 与 `supportedLanguages`
- `PROTOCOL_NOT_SUPPORTED` 升级提示文案（中英），为 v0.9 协议清理做准备

### Improved
- 静态文案通过 `data-i18n` / `data-i18n-html` 更新；动态文案统一走 `t()`
- 日期、时长、`html lang` 随当前语言切换

### Technical
- 客户端白名单 13 → 14 个文件（`i18n.js` 排在 `app.js` 之前）
- 总测试数：273 个（272 通过，1 跳过）

## [0.7.0] - 2026-09-12

### Added
- **用户文档**
  - 配置指南（docs/configuration.md）- 所有配置项详细说明
  - 故障排查指南（docs/troubleshooting.md）- 常见问题和解决方案
- **API 文档**
  - HTTP API 文档（docs/api/http-api.md）
  - WebSocket 协议文档（docs/api/websocket-protocol.md）
- **多语言**
  - 英文版 README（README.en.md）- 完整核心信息英文入口
  - 中英文 README 互相跳转

### Improved
- 文档体系完善
- 用户和开发者文档齐全
- 故障排查流程清晰
- README 版本号漂移修正（v0.1 Alpha → v0.7.0）

### Fixed
- **v0.5.0 遗留问题：`error-states.js` 与 `performance.js` 是死代码**（此前既未进静态白名单、也未被任何代码引用）
  - 两个模块加入 `src/transport/http.js` 的 `CLIENT_FILES` 白名单（11 → 13 个文件）
  - `index.html` 引入两个脚本，`performance.js` 排在 `overlays.js` 之前
  - 错误反馈统一接入 `app.js`：连接状态指示器由 `errorController` 单一维护，
    离线 / 重连彻底失败 / 恢复分别走 `handleError` / `showErrorOverlay` / `clearError`
  - 新增阻塞性错误覆盖层（`#errorOverlay`）：重连彻底失败时用整屏提示 + "刷新页面"按钮，
    取代原先一闪而过的 toast
  - `overlays.js` 的成员列表用 `shouldRebuildList` 跳过无变化的整表重建
  - `app.js` 的频道占用更新用 `smartUpdate`，人数未变时不重写 `innerHTML`
  - 裁剪 `performance.js`：移除 6 个没有任何调用点的 helper，只保留真正被使用的两个
  - 新增 `test/client-assets-wiring.test.js`：强制白名单与 `index.html` 保持一致
- 文档全部按代码核实，消除"文档漂移"：
  - 配置字段名与 `pavilo.example.yaml` / 配置加载器严格对齐（此前部分示例使用了 schema 之外的字段名，照抄会导致启动失败）
  - 默认端口统一为 `4173`（此前部分示例误用 `3000`）
  - 启动日志示例改为 `server.js` 的真实输出格式
  - `/healthz` 响应体改为真实的 `{ ok, users, messages, roomBytes, clients, ephemeral }`；
    并说明实现中**没有返回非 200 的分支**
  - 错误信息改为配置加载器的真实文案（如 `room.defaultChannel: 默认频道不能是只读频道`）
  - 文档中的完整配置示例已通过 `npm run config:check` 实测
- 既有文档的同类漂移：
  - `docs/architecture/chat-protocol.md`：频道公开字段补上遗漏的 `readOnly` 与 `welcome`，
    并补上 `deprecatedProtocols`
  - `docs/healthcheck.md`：删除不存在的 "503 Service Unavailable" 分支描述

### Technical
- 总测试数：260 个（259 通过，1 跳过）
- 新增 6 个文档文件、1 个接线回归测试
- 现有架构文档已完善（docs/architecture/）

## [0.6.0] - 2026-09-12

### Added
- Issue 模板系统
  - Bug 报告模板（.github/ISSUE_TEMPLATE/bug_report.md）
  - 功能请求模板（.github/ISSUE_TEMPLATE/feature_request.md）
  - 安全问题报告模板（.github/ISSUE_TEMPLATE/security_report.md）
  - Issue 模板配置文件（.github/ISSUE_TEMPLATE/config.yml）
- Bug 管理文档
  - Bug 分类和优先级标准（docs/bug-classification.md）
  - Bug 修复 Checklist（docs/bug-fix-checklist.md）
- 版本号管理流程文档（docs/version-management.md）
  - 语义化版本规则
  - 发布流程完整指南
  - Git 提交规范
  - 版本废弃策略
  - 热修复流程

### Improved
- 质量保证流程标准化
- Issue 管理更规范
- 版本发布流程更清晰

### Technical
- 测试保持稳定：254 个（253 通过，1 跳过）
- 新增 4 个 GitHub 模板文件
- 新增 3 个流程文档

## [0.5.0] - 2026-09-12

### Added
- 错误状态统一管理模块（client/error-states.js）
- 性能优化工具模块（client/performance.js）
- 浏览器兼容性验收清单（docs/v0.5.0-browser-compatibility.md）
- 错误状态测试套件（7 个测试）
- 性能工具测试套件（13 个测试）

### Improved
- 统一错误状态反馈系统（网络离线、连接失败、服务停止、频道不可用）
- 只读频道 UI 已完善（🔒 图标、禁用输入、明确提示）
- 图片懒加载已在 v0.3.0 实现（使用 loading="lazy" 属性）
- DOM 批量更新工具，减少大量数据下的性能开销
- 节流和防抖工具，优化频繁更新的性能

### Changed
- 错误提示文案更清晰、更易理解
- 连接状态指示器支持更多状态变体（离线、连接中、警告）

### Technical
- 新增 20 个测试用例
- 总测试数：254 个（253 通过，1 跳过）
- 测试覆盖率保持稳定

## [0.4.0] - 2026-09-12

### Added
- HTTP 安全响应头
  - `X-Frame-Options: DENY`（防止点击劫持）
  - `Referrer-Policy: strict-origin-when-cross-origin`（控制 Referrer 泄漏）
  - 统一加到所有 HTTP 响应（HTML / CSS / JS / JSON / vendor）
- 安全头测试套件（`test/security-headers.test.js`）
- 畸形输入测试套件（`test/malformed-input.test.js`）
  - 畸形 YAML 配置解析
  - 非法配置值校验
  - 深层嵌套频道配置
  - 特殊字符处理
- 按 Keep a Changelog 格式创建 `CHANGELOG.md`
  - 回溯记录 v0.1.0、v0.2.0、v0.3.0

### Changed
- `package.json` 版本号从 0.1.0 更新为 0.4.0
- 精简 `ROADMAP.md`（去掉性能测试，保持聚焦）

### Security
- 用额外响应头加强 HTTP 安全基线

### Tests
- 总测试数：234 个（233 通过）
- 新增 9 个测试（3 个安全头 + 4 个畸形输入 + 2 个配置校验）

## [0.3.0] - 2026-09-12

### Added
- **Docker 支持**：多阶段构建与安全加固
  - 基于 Node 22 Alpine 的 Dockerfile
  - 非 root 用户（pavilo:pavilo，uid/gid 1001）
  - 只读根文件系统
  - 内置健康检查（`/healthz`）
  - 安全选项（`no-new-privileges`、`cap_drop: ALL`）
- 可用于生产的 `docker-compose.yml`
- 优化构建上下文的 `.dockerignore`
- **更清晰的启动日志**
  - 应用版本
  - 协议版本（v4）
  - 存储模式（ephemeral）
  - 配置来源（文件路径或内置默认值）
  - 网络地址（本机 + 局域网）
  - 安全边界（Origin 检查、IP 可见性、容量上限）
- **部署文档**
  - Docker 部署指南（`docs/deployment/docker.md`）
  - Nginx / Caddy 反向代理配置（`docs/deployment/reverse-proxy.md`）
  - 健康检查契约（`docs/healthcheck.md`）
- **离线启动验证**：确认不依赖公网第三方资源

### Changed
- 启动日志展示更完整的系统信息
- README 增加 Docker 快速开始

### Fixed
- 配置加载时明确打印配置来源

## [0.2.0] - 2026-09-12

### Added
- **Protocol v4**：稳定 WebSocket 协议
  - 消息 ACK，客户端跟踪确认
  - `clientMessageId` 幂等去重
  - 断线自动重连与历史补齐
  - 基于序号的顺序保证
- **表情回应**：6 个快捷表情（👍 ❤️ 😂 🎉 👀 🔥）
- **图片上传与页内展示**
  - 拖放
  - 剪贴板粘贴
  - 单张上限 300 KB
  - 支持 JPEG、PNG、WebP
- **消息回复**
- **界面增强**
  - 深色模式，跟随系统主题
  - 玻璃态设计
  - 微交互动画
  - 响应式移动端布局
  - 键盘操作
- **只读频道**：适合公告与规则
- **在线成员列表**
- **输入状态提示**
- **浏览器通知**（需用户点击后申请权限）
- **未读提示**（标题角标、动态图标）
- 设计语言文档（`docs/design-language.md`）
- 测试策略文档（`docs/TEST_STRATEGY.md`）
- 测试套件（200+ 个）
  - 核心逻辑单元测试
  - WebSocket 协议集成测试
  - Playwright 浏览器验收

### Changed
- 升级到 Protocol v4（当时仍兼容 v1/v2/v3）
- 改善连接稳定性与错误处理
- Origin 校验加强安全
- Lucide 图标与表情选择器改为自托管

### Security
- WebSocket Origin 校验
- 消息与回应限流
- 输入校验
- 资源上限（人数、连接、消息、字节）

## [0.1.0] - 2026-09-12

### Added
- **首个版本**：默认临时的聊天系统
- **多频道**，可由配置定义
- **基于 WebSocket 的实时通信**
- 消息 Markdown
- YAML 配置（`pavilo.yaml`）
- 优雅停服（SIGINT / SIGTERM）
- 静态文件提供，支持 gzip
- 静态资源 ETag 缓存
- **内置默认值**：没有配置文件也能启动
- **安全边界**
  - 用户数与连接数上限
  - 消息大小上限
  - 频道容量上限
  - 写缓冲 backpressure
- **文档**
  - README 快速开始
  - 配置示例
  - 贡献指南（`CONTRIBUTING.md`）
  - 安全政策（`SECURITY.md`）
  - 行为准则（`CODE_OF_CONDUCT.md`）
  - 路线图（`ROADMAP.md`）

### Architecture
- 纯内存存储（仅 ephemeral 模式）
- 需要 Node.js 22+
- 运行时依赖只有 `yaml`
- core 与 transport 分层
- 协议版本协商

---

## 版本摘要

- **v1.6.0** — 嵌入预览：宿主 iframe、`/embed`、玩法留在嵌入区域
- **v1.5.0** — 举报、墓碑移除、稳定用户拒绝、操作记录
- **v1.4.0** — 功能目录与宿主 JWT 身份
- **v1.3.0** — 可选网关、值班台、人员治理与 Play 宿主
- **v1.0.0** — Ephemeral Stable
- **v0.9.0** — Protocol v4 only Release Candidate
- **v0.3.0** — Docker 支持与可部署性
- **v0.2.0** — Protocol v4、回应、图片、界面增强
- **v0.1.0** — 首个临时聊天系统

## 链接

- [GitHub 仓库](https://github.com/caigg188/Pavilo)
- [Issue](https://github.com/caigg188/Pavilo/issues)
- [路线图](ROADMAP.md)
