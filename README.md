# Pavilo / 语亭

<p align="center">
  <img src="docs/logo/pavilo-lockup.svg" width="520" alt="Pavilo / 语亭">
</p>

> 一条命令，给身边的人一间聊天室；按需组装，为自己的产品接入讨论空间。

**简体中文** · [English](README.en.md)

Pavilo（**Pavilion + Local**）是浏览器即用、默认临时、可自托管、可按需组装的轻量聊天工具，也在向方便接入已有产品的聊天与玩法能力演进。像一座随处可搭的小亭：启动 Node.js 进程，同一局域网里的人打开网页就能交谈；默认内存模式下，服务停止后聊天记录回到空白。

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.6.0-0f7772">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f7772">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D22-0f7772">
  <img alt="Protocol v4" src="https://img.shields.io/badge/protocol-v4-0f7772">
</p>

当前版本 **v1.6.0**：默认仍是无数据库的临时群聊；可用 Config Schema v2 可选启用 SQLite（默认留存 30 天，支持历史分页与备份）。sqlite 下可打开 `/admin` 值班台、可选 AI 网关与 Play 宿主，并可按频道开关功能、接入宿主 JWT 身份。有值班台时可以举报、墓碑移除内容，并拒绝稳定用户。配了 `embed.ancestors` 后，宿主可以用 iframe 打开 `/embed`。界面提供简体中文与英语，WebSocket 协议只接受 v4。适合可信局域网、私有网络或 VPN 环境。

<p align="center">
  <img src="docs/screenshots/overview.png" width="880" alt="Pavilo 界面预览：桌面聊天、登录页与移动端">
</p>

## 面向谁，以及正在走向哪里

- **独立使用者**：给局域网、活动或私有团队一间浏览器即用的聊天室，默认不持久化，也可显式开启 SQLite。
- **个人开发者与小型社区维护者**：自己把语亭跑起来，再把一段说明交给自己项目的 Agent，嵌进网页或 App。项目不提供服务器。不含小程序。不发布 SDK。见 [接入说明](docs/integrate.md)。
- **玩法和扩展贡献者**：按照主线提供的契约开发 Play、Agent、审核策略与事件扩展；官方维护基础设施和完整参考玩法。

| 状态 | 能力 |
| --- | --- |
| 已发布：v1.2.0 | 临时聊天、可选 SQLite 留存与分页/备份等运维能力 |
| 已发布：v1.3.0 | AI 网关、管理后台、房间/频道配置、席位禁言/请离/IP 黑名单、Play/Agent 宿主和 echo 夹具 |
| 已发布：v1.4.0 | 功能目录、宿主 JWT 身份与频道授权 |
| 已发布：v1.5.0 | 治理闭环：举报、墓碑移除、稳定用户拒绝、操作记录 |
| 已发布：v1.6.0（最新稳定版） | 嵌入预览：宿主 iframe 打开 `/embed`，玩法留在嵌入区域 |
| 进行中 | 一段话接入网页和 App。不含小程序。不发布 SDK |

**不发布接入 SDK。** 对方复制 [接入说明](docs/integrate.md) 开头的那段话，交给自己项目的 Agent。v1.6 的 iframe 示例仍在 [examples/host-embed/](examples/host-embed/)。

默认临时模式始终保留；狼人杀作为官方完整 Play 示例，与基础设施并行开发，并在 v2.0 前完成。阶段与暂缓范围见 [路线图](ROADMAP.md)，接口边界见 [集成设计（规划中）](docs/integration.md)。本文配置和能力说明以当前稳定版为准。

## 设计原则

- **开箱即用**：安装依赖后一条命令启动，参与者只需要浏览器。
- **保持轻量**：服务端主要使用 Node.js 内置模块，必需依赖只有 `yaml`，`better-sqlite3` 为可选 SQLite 驱动；前端资源全部自托管。
- **临时优先**：默认不使用数据库、不持久化聊天记录；SQLite 留存由部署者显式开启。
- **部署者可控**：运行在自己的电脑或服务器上，不依赖外部账号和云服务。
- **按需扩展**：持久化已经可选；权限、审核、功能组装与产品接入逐步建设，不让默认部署变重。

## 功能

**聊天体验**

- 输入用户名即可进入默认频道；配置多个频道后可在界面中切换，频道列表显示各频道实时在线人数
- 界面语言可在简体中文与英语之间切换；首次访问使用 `room.defaultLanguage`（默认 `zh-CN`），之后记住本机选择
- 频道之间隔离消息、在线成员、输入状态和回应；每个频道有独立临时历史及人数上限
- 只读频道（`readOnly: true`）：可进入、浏览历史、使用表情回应，但所有人都不能发消息；适合公告、规则等由部署者维护的内容
- 频道欢迎语（`welcome`）：频道顶部显示的导言卡，介绍频道用途、规则或玩法
- 刷新页面仍在聊天页：会话身份只存在当前标签页的 `sessionStorage` 中，刷新自动恢复；只有点击”离开”（需二次确认）才会回到登录页
- 文字、表情、图片（PNG / JPEG / GIF / WebP，默认单张上限 300 KB）；可粘贴、拖入或点附件先暂存缩略图，配文与图片发在同一条消息里；表情选择器支持搜索、肤色和中文关键词
- 回复消息，每条消息显示精确到秒的发送时间
- @ 提及频道成员，被提及时高亮显示，点击可查看成员资料
- 随机生成头像，点击头像查看用户名、IP（默认显示，可配置关闭）和在线时长
- 在线成员列表、加入/离开提示、输入状态提示
- 图片在页内查看器里打开：缩放、旋转、还原、下载，多图可用方向键翻页，桌面端可拖动平移、滚轮缩放
- 消息回应固定为 6 个表情（👍 ❤️ 😂 🎉 👀 🔥）
- 响应式移动端布局、键盘操作与减少动态效果支持

**界面与资源**

- 完整的**深色模式**支持，自动适配系统主题偏好
- 现代**玻璃态（Glassmorphism）**设计，半透明背景与模糊效果
- 流畅的**微交互动画**：按钮弹性反馈、表情弹跳、脉冲动画等
- 精心设计的**色彩系统**和间距规范，详见 [设计语言文档](docs/design-language.md)
- 图标来自自托管的 [Lucide](https://lucide.dev)（`vendor/lucide`，ISC 许可）
- 表情选择器来自自托管的 `vendor/emoji-picker`（Apache-2.0 许可）
- 服务端静态白名单提供聊天页、样式、明确列出的 `client/` 模块及所需的 `vendor/` 资源；sqlite 且配置了 operator token 时另提供值班台，启用玩法时另提供该玩法的 `page/` 与 `assets/`，不提供任意仓库文件
- 静态文本资源按 `Accept-Encoding` 协商 gzip，压缩结果按 ETag 缓存，响应带 `Vary: Accept-Encoding`；不支持 gzip 的客户端仍收到原始字节

**可靠性**

- 消息由服务端确认接收（ACK），未确认或失败的内容可在当前页面重试
- 相同消息 ID 幂等去重，短暂断线或刷新可恢复临时身份
- 图片发送前在浏览器内降采样到长边 1600 px 并按大小在质量 0.5–0.82 之间收敛；GIF 保留动画、不降采样，仍受同一条上限约束
- 正常停服会让页面回到登录状态；意外断线继续重连。内存模式的新进程产生新的频道纪元，SQLite 正常重启保留纪元；纪元变化时，旧的未确认内容不会自动发入新房间
- YAML 配置使用版本、严格类型、未知键、重复键、别名和交叉容量校验
- **Protocol v4 only**：`join.protocolVersion` 必须为 `4`。热升级后未刷新的标签页会提示刷新页面

**值班台、网关与玩法（可选，默认关闭）**

- sqlite 且 `operator.token` 至少 16 字符时可打开 `/admin`：总览、房间、聊天频道、人员席位、AI 网关
- 房间、聊天频道、IP 黑名单和稳定用户拒绝名单可在值班台保存，立即生效；YAML 同段被认领后忽略，可恢复为配置文件。已打开的聊天页需刷新
- 人员页管理当前进程的临时席位：禁言、请离、IP 黑名单、待处理举报、身份拒绝和最近操作。不是会员名录，也不是宿主身份。席位发言可以墓碑移除
- 模型渠道和 API key 只在值班台「AI 网关」配置，不写进 YAML；聊天核心不依赖 AI
- 可选 `plays` 与 `channels[].play`（要求 sqlite）：进入玩法频道打开独立玩法页。仓库内 `echo` 是契约夹具，默认不要启用；官方狼人杀仍由协作者开发

**当前只读边界**

- 进亭的人不能编辑或删除已发出的消息，只能通过表情回应。有值班台时，操作者可以墓碑移除：正文、图片和引用预览不再展示，这条记录还在。内存模式没有举报和移除入口
- 默认无历史持久化（可在 Config Schema v2 中可选启用 SQLite，默认留存 30 天）；无私聊、搜索、账号或角色权限
- `enabled: false` 的频道完全不可加入；`readOnly: true` 的频道可以加入、浏览历史、使用表情回应，但所有人都不能发消息（没有例外，也没有管理员豁免）
- 只读频道适合公告、规则等由部署者维护的内容；改 YAML 后需重启，值班台保存聊天频道后立即生效（已打开的页面需刷新）

**提醒（渐进式）**

- 页内未读计数与“回到底部”按钮、标题未读角标、动态图标徽标
- “开启提醒”只会在用户点击后请求浏览器通知权限，绝不自动弹窗
- 普通局域网 HTTP 地址即使无法使用系统通知，页内提醒也始终可用

## 快速开始

### 本地运行

需要 Node.js 22+。克隆仓库后按锁文件安装依赖：

```bash
npm ci
npm start
```

默认监听 `0.0.0.0:4173`，启动后终端会打印本机与局域网访问地址：

- 本机访问：`http://localhost:4173`
- 局域网访问：`http://<主机局域网 IP>:4173`

把局域网地址发给连接同一 Wi-Fi 或私有网络的用户即可。临时更换端口：

```bash
PORT=8080 npm start
```

### Docker 部署

使用 Docker Compose（推荐）：

```bash
git clone https://github.com/caigg188/Pavilo.git
cd Pavilo
docker compose up -d
```

或者手动构建和运行：

```bash
docker build -t pavilo .
docker run -d -p 4173:4173 --name pavilo pavilo
```

详见 [Docker 部署文档](docs/deployment/docker.md)。

### 生产部署

- **反向代理**：参考 [Nginx/Caddy 配置指南](docs/deployment/reverse-proxy.md)
- **健康检查**：参考 [健康检查契约文档](docs/healthcheck.md)

停止服务请按 `Ctrl-C`。

## 协议稳定性

v1.0 起只接受 [Protocol v4](docs/api/websocket-protocol.md)，并在整个 v1.x 系列保持稳定。v1–v3 已删除。第三方客户端见 [迁移说明](docs/api/websocket-protocol.md#从旧协议迁移)。

## 配置

Pavilo 按以下优先级加载配置（越靠后优先级越高）：

1. 内置默认值；
2. 默认路径 `./pavilo.yaml`，文件不存在时安静回退到内置默认值；
3. `PAVILO_CONFIG` 指向的 YAML 文件；
4. `PORT` 环境变量，只覆盖最终端口。

`PAVILO_CONFIG` 一旦显式设置，目标缺失、不可读、过大、不是普通文件或校验失败都会使启动失败，不会回退。`PORT` 只接受 `1` 至 `65535` 的严格十进制字符串，例如 `4173`；`4173.0`、`0x105d`、空格和正负号均无效。

创建配置。仓库提供两份可直接复制的示例：

```bash
# 内存模式（默认，重启即空）
cp pavilo.example.yaml pavilo.yaml

# 或 SQLite 留存（默认最近 30 天；模型渠道在 /admin 配置）
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data

npm run config:check
npm start
```

也可使用仓库外路径：

```bash
PAVILO_CONFIG=/etc/pavilo/config.yaml npm run config:check
PAVILO_CONFIG=/etc/pavilo/config.yaml npm start
```

修改 YAML 后必须**重启进程**，运行中的服务不会热加载 YAML。`npm run config:check` 只校验并显示实际配置来源（含房间/聊天频道是 YAML 还是管理页），不启动服务。sqlite 管理页保存过的房间或聊天频道以数据库为准，立即生效，不必重启。

配置必须声明 `version: 1` 或 `2`（`3` 视为 `2`）。`version: 1` 是内存模式，禁止 `storage` / `operator` / `plays`。`version: 2` 是 SQLite 家族：可写 `storage`、`operator.token`、`plays`；管理页、网关和玩法都要求 sqlite。模型渠道只在 `/admin` 配置，不写进 YAML。sqlite 而未填 token 时服务仍启动，但会提示无法打开管理页。YAML 使用严格类型：布尔值写作 `true` / `false`，数字写作整数；未知配置项、重复键、未知 tag、锚点/别名和非对象根节点都会被拒绝。可复制示例只有两份：内存见 [`pavilo.example.yaml`](./pavilo.example.yaml)，SQLite 家族（留存、值班台、玩法、宿主身份）见 [`pavilo.sqlite.example.yaml`](./pavilo.sqlite.example.yaml)。

### 频道和人数语义

- 不提供 `channels` 时，会保留内置 `general` 和 `project`，各频道 `maxUsers` 自动收紧到 `server.maxUsers`，因此可以只调低全局人数。
- 一旦提供 `channels`，列表就是完整替换而非与 `general` 合并；**非 `general` 默认频道**需同时出现在列表中、启用，并由 `room.defaultChannel` 指定。
- `server.maxUsers` 是全局成员上限；`channels[].maxUsers` 是单频道上限，且不得超过全局上限。
- 全局和频道人数都包含 `timeouts.sessionLeaseMs` 内暂时断线、仍可恢复身份的成员。连接总数由 `server.maxConnections` 单独限制。
- 至少要启用一个可发言的频道（`enabled: true` 且 `readOnly` 不为 `true`）；只读频道可以浏览，但不计入”可发言”的最低要求。

示例：自定义频道并设为默认频道：

```yaml
version: 1
room:
  defaultChannel: projects
channels:
  - id: projects
    name: 项目讨论
    enabled: true
    maxUsers: 24
```

_注：内置默认频道为 `general` 和 `project`（单数）。_

### 配置文件安全

Pavilo 的 HTTP 服务采用静态白名单，`pavilo.yaml`、`pavilo.example.yaml` 和 `pavilo.sqlite.example.yaml` 不会被应用直接提供；配置加载器也拒绝把 `index.html`、`chat.css` 或 `vendor/`、`client/` 内文件（包括通过符号链接指向它们的文件）用作配置。但这不是认证机制：聊天页面、房间元数据和前端资源对任何能访问监听端口的人开放。

- 不要把真实配置放入 `vendor/`、`client/`、其他 Web 根目录、对象存储公开目录或反向代理的静态目录。
- 反向代理只能转发 Pavilo 的应用端口，不得额外把整个仓库目录作为静态站点；否则代理可能绕过应用白名单，泄漏原始 YAML、源码或其他文件。
- 原始 YAML **不得提供下载**。如配置包含内部域名或网络策略，更应放在仓库外并设置操作系统文件权限。
- `allowedOrigins` 只校验 WebSocket 浏览器 Origin，**不是用户认证或访问控制**；`allowNoOrigin: true` 还允许没有 Origin 的客户端。
- 直接连接时服务看到真实 IP；反向代理下当前版本不信任 `X-Forwarded-For`，成员看到的可能是代理 IP，同 IP 连接限制也会按代理 IP 聚合。不要为“修复”显示而让代理公开仓库，也不要把未受保护的端口直接暴露公网。

## 容量与临时数据边界

**消息 ACK** 在内存模式表示“本次服务进程已接受”，SQLite 模式在事务提交后发出；两者都不表示所有成员已送达或已读。默认容量包括：每频道最多 300 条历史、约 32 MB 消息预算、单图 300 KB、全局 64 名成员、80 个连接、同一 IP 12 个连接，以及慢连接写缓冲上限；超限时优先淘汰最旧消息。

图片上限直接决定一个频道能留住多少张图：单图 300 KB 时约 79 张，旧默认值 1.5 MB 时只有 16 张——一张原图就能吃掉频道约 5% 的容量，所以调高 `limits.maxImageBytes` 要连同 `limits.maxChannelBytes` 一起考虑。客户端会在上传前把长边降到 1600 px，所以手机原图通常远小于这个上限；但 GIF 不做降采样，可能因此被拒绝。

配置校验要求最大图片的 base64/最长文字消息、全局最大人数对应的成员列表 JSON、WebSocket 帧及写缓冲可以相互容纳。这些是防止配置自相矛盾的保守下限，不是内存使用承诺；提高人数、图片、历史或缓冲上限会显著增加内存需求。

**临时数据**：会话和在线状态始终属于运行时；内存模式下消息与回应也不持久化，SQLite 模式则按留存配置保存。浏览器不使用 `localStorage`、Cache Storage 或 IndexedDB 保存聊天内容；语言偏好使用 `localStorage`，表情数据和个人常用表情计数使用 IndexedDB，均不涉及聊天内容。

为了让刷新仍停留在聊天页，当前标签页会在 `sessionStorage` 中保存房间签发的随机恢复令牌与用户名，不含消息。它随标签页关闭而消失，点击“离开”会立即清除；服务重启后自动失效。

**提醒边界**：系统通知需要浏览器权限与安全上下文，`http://<局域网 IP>` 通常不可用，此时自动降级为页内提醒。浏览器权限本身由浏览器管理，服务停止后仍可能存在。

## 在服务器上运行

Pavilo 可以运行在能执行 Node.js 的服务器上，但**当前部署边界仍是可信网络**（内网、VPN 或其他有访问控制的私有网络）。当前没有聊天用户认证、内置 TLS、端到端加密或完整公网风控，请勿把端口直接暴露到公网。

成员资料默认向频道内参与者显示完整连接 IP，这是当前产品行为；可设置 `room.exposeMemberIps: false` 关闭显示。无论是否显示，服务仍需使用连接 IP 执行单 IP 连接限制。请只在可信环境中使用。

`/room-info` 默认会列出主机的所有局域网地址，方便把入口发给同网段的人；不需要时可设置 `room.exposeLanUrls: false`，接口改返回空数组。另外，`/healthz` 会报告当前人数、连接数与内存中的消息字节数，用于存活检查和观测。这些端点都不需要认证，和聊天页一样对任何能访问监听端口的人开放。

## 开发与测试

```bash
npm ci                  # 严格按 package-lock.json 安装依赖
npm run config:check    # 校验实际将加载的配置
npm test                # 运行 test/*.test.js
node --check config.js
node --check server.js
```

测试覆盖配置、客户端协议/状态/pending/图片规则、无网络聊天内核，以及 HTTP / WebSocket 的历史分块、ACK、幂等去重、恢复身份、Origin、心跳、回应、静态资源和生命周期；频道测试覆盖隔离、原子切换、人数租约与容量淘汰。

浏览器验收使用已安装的 Google Chrome，Playwright 单独安装到仓库外，不进入运行时依赖：

```bash
npm install --prefix /tmp/pavilo-browser-verify --no-package-lock playwright
PAVILO_PLAYWRIGHT_PATH=/tmp/pavilo-browser-verify/node_modules/playwright npm run test:browser
```

脚本自动创建仓库外临时 YAML、分配回环端口、驱动双页面，并只关闭自己启动的进程。覆盖频道隔离/切换失败、刷新/断线恢复、IME、图片查看器、阅读位置、移动端抽屉和正常停服；移动键盘使用缩小视口模拟，不能代替真机输入法验收。

模块边界和维护约定见 [架构概览](docs/architecture/overview.md)、[协议契约](docs/architecture/chat-protocol.md)、[状态契约](docs/architecture/state-model.md)、[设计语言](docs/design-language.md) 和 [浏览器兼容性](docs/v0.5.0-browser-compatibility.md)。

架构决策与演进策略见：
- [架构原则](docs/architecture/principles.md) — 核心设计哲学与不变量
- [架构演进](docs/evolution.md) — 未来扩展边界
- [接入说明](docs/integrate.md) — 交给另一个项目的 Agent 的那段话
- [集成设计（规划中）](docs/integration.md) — 早期边界备忘，接入不要按其中的 SDK 表实现
- [玩法契约](docs/play.md) — 频道绑定与独立玩法页契约（v1.3）
- [架构决策记录](docs/adr/) — 重大技术决策的背景与权衡
- [产品路线图](ROADMAP.md) — 版本规划与发布门槛
- [v1.3 收口清单](docs/v1.3-closeout.md) — v1.3.0 已完成
- [v1.4 设计](docs/v1.4-design.md) — 功能目录与宿主身份（实现中）

## 项目结构

```text
.
├── config.js           # YAML / 环境变量配置加载与校验
├── pavilo.example.yaml        # 内存模式完整示例（cp 为 pavilo.yaml）
├── pavilo.sqlite.example.yaml # SQLite 家族示例（留存；玩法/身份为注释块）
├── index.html          # 页面骨架、资源引用与启动入口
├── chat.css            # 页面样式（深色模式、玻璃态、微交互）
├── client/             # 协议、连接、状态、pending 与独立视图模块
├── admin/              # 值班台页面（sqlite + operator.token）
├── server.js           # 配置、core/transport 组合与兼容启动入口
├── src/core/           # 不依赖网络的房间、会话、命令与领域事件
├── src/storage/        # ConversationStore；npm run storage 维护 CLI
├── src/transport/      # HTTP 静态白名单、WebSocket 连接与帧协议
├── src/gateway/        # 进程内 AI 网关（可选，默认关闭）
├── src/operator/       # 值班台鉴权、配置覆盖层与人员治理
├── src/play/           # Play/Agent 宿主
├── plays/              # echo 契约夹具；官方狼人杀目录仍为规划
├── vendor/             # 自托管的第三方前端资源
├── scripts/            # Lucide 资源构建脚本
├── test/               # Node 单元/集成测试及独立浏览器验收
├── docs/
│   ├── architecture/   # 当前架构、协议与状态契约
│   ├── evolution.md    # 目标架构（规划）
│   ├── integration.md  # 宿主接入边界（规划）
│   └── design-language.md  # 设计语言、色彩系统与组件规范
├── package.json        # 元数据、依赖与命令
├── ROADMAP.md          # 已发布 / 主分支已实现 / 计划中
└── LICENSE             # MIT 许可证
```

## 许可证

Pavilo 使用 [MIT License](./LICENSE) 开源。
