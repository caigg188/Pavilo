# 配置指南

> 本文对应当前仓库配置。`identity` / `channels[].features` / `channels[].access` 已随 v1.4 发布；`moderation.userDenyList` 已随 v1.5 发布；`embed.ancestors` 已随 v1.6 发布。`embed.direct` 与 fragment 凭证从 v1.7.0 起包含，v1.6.0 没有这两项。省略 `embed` 则没有 `/embed`。接入见 [接入说明](integrate.md)，不发布 SDK。

本文档逐项说明 Pavilo 的全部配置项。

> **事实来源**：本文的字段名、默认值与语义均取自 [`pavilo.example.yaml`](../pavilo.example.yaml)、[`pavilo.sqlite.example.yaml`](../pavilo.sqlite.example.yaml) 与配置加载器实现。Pavilo 使用**严格 schema**：未知配置项、重复键、未知 tag、锚点/别名和非对象根节点都会被拒绝并导致启动失败。因此**不要使用本文档之外的字段名**。

## 配置文件位置与优先级

Pavilo 按以下顺序加载配置（越靠后优先级越高）：

1. **内置默认值**
2. **默认路径** `./pavilo.yaml` —— 文件不存在时安静回退到内置默认值
3. **`PAVILO_CONFIG`** 指向的 YAML 文件
4. **`PORT`** 环境变量 —— 只覆盖最终的监听端口
5. **`PAVILO_OPERATOR_TOKEN`** —— 覆盖 `operator.token`
6. **`PAVILO_IDENTITY_SECRET`** —— 覆盖唯一 `identity.issuers[0].secret`（必须恰好声明一个签发方）

`PAVILO_CONFIG` 一旦显式设置，目标缺失、不可读、过大、不是普通文件或校验失败都会使启动**失败**，不会回退到默认值。

`PORT` 只接受 `1` 至 `65535` 的严格十进制字符串（例如 `4173`）；`4173.0`、`0x105d`、带空格或正负号的形式均无效。

仓库提供两份可直接复制的示例：

```bash
# 内存模式（默认，重启即空）
cp pavilo.example.yaml pavilo.yaml

# 或 SQLite 留存（默认最近 30 天；模型渠道在 /admin 配置）
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data
openssl rand -hex 32    # 写入 operator.token，或 export PAVILO_OPERATOR_TOKEN=...

npm run config:check    # 只校验并显示实际配置来源，不启动服务
npm start
```

也可使用仓库外路径：

```bash
PAVILO_CONFIG=/etc/pavilo/config.yaml npm run config:check
PAVILO_CONFIG=/etc/pavilo/config.yaml npm start
```

修改 YAML 后必须**重启进程**，运行中的服务不会热加载 YAML。sqlite 且打开了 `/admin` 时，房间和聊天频道可以在管理页保存；一旦保存，该段以数据库为准并立即生效，见 [admin.md](admin.md) 与 [ADR-0007](adr/0007-pavilion-config-overlay.md)。`npm run config:check` 会打印房间和聊天频道当前真源（`yaml` 或 `operator`）。

## 完整配置示例

下面是所有配置项及其**代码默认值**：

```yaml
version: 1

server:
  host: 0.0.0.0
  port: 4173
  maxUsers: 64
  maxConnections: 80
  maxConnectionsPerIp: 12
  allowNoOrigin: true
  allowedOrigins: []

room:
  title: 语亭 · 临时频道
  defaultChannel: general
  exposeMemberIps: true
  exposeLanUrls: true
  defaultLanguage: zh-CN

channels:
  - id: general
    name: 闲聊
    description: 轻松聊聊，只留当下。
    enabled: true
    maxUsers: 64

limits:
  maxMessagesPerChannel: 300
  maxTextLength: 2000
  maxImageBytes: 300000
  maxImageDimension: 1600
  maxImagePixels: 4000000
  maxJsonBytes: 524288
  maxWebSocketFrameBytes: 1572864
  maxChannelBytes: 33554432
  maxWritableBytes: 2097152
  maxDedupeEntries: 512

timeouts:
  joinMs: 12000
  heartbeatIntervalMs: 30000
  heartbeatTimeoutMs: 75000
  typingTtlMs: 4000
  sessionLeaseMs: 15000
  dedupeTtlMs: 600000

rateLimits:
  windowMs: 5000
  messages: 8
  reactions: 20
  typing: 12
```

---

## 配置项详解

### `version`

```yaml
version: 1
```

- **必填**（配置文件）
- **类型**：整数
- **说明**：配置文件结构版本。对外只有 **1（内存）** 和 **2（SQLite 家族）**。
  - `1`：内存模式；**禁止** `storage` / `operator` / `plays`，内部归一为 `storage.driver: memory`
  - `2`：可写 `storage`、`operator.token`、`plays`。管理页、网关渠道、玩法都要求 `storage.driver: sqlite`
  - `3`：视为 2 的别名（未发版示例曾用过），新文件请写 `2`
  - 其它 version 一律拒绝。YAML 里出现 `gateway:` 一律拒绝

---

### `plays` —— 可选玩法模块（`version: 2` + sqlite）

默认不启用。playId 必须对应仓库内 `plays/<id>/`（含 `play.json`、`host.js`、`page/index.html`）。**必须** `storage.driver: sqlite`。在 [`pavilo.sqlite.example.yaml`](../pavilo.sqlite.example.yaml) 里取消 `plays` 与 echo 频道的注释即可试用。

```yaml
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
plays:
  - echo
channels:
  - id: echo
    name: 回声桌
    play: echo
```

`echo` 是契约夹具，不是给最终用户的游戏。官方狼人杀实现后把 playId 换成 `werewolf`。Agent 调用模型仍走 `/admin` 配置的网关。

### `storage` —— 可选持久化（`version: 2`）

默认安装不需要这一节。未写 `storage`、或 `driver: memory` 时，行为与 v1.0 完全一致：重启即空。完整可运行示例见 [`pavilo.sqlite.example.yaml`](../pavilo.sqlite.example.yaml)（`cp pavilo.sqlite.example.yaml pavilo.yaml`）。

```yaml
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
    engine: auto
    retentionDays: 30
```

#### `storage.driver`

- **默认值**：`memory`
- **类型**：`memory` 或 `sqlite`
- **说明**：`memory` 时禁止出现 `sqlite` 子块，避免配了却没生效。

#### `storage.sqlite.path`

- **必填**（仅 `driver: sqlite`）
- **类型**：字符串
- **说明**：数据库文件路径。相对路径相对配置文件所在目录解析。不能指向 Pavilo 的 HTTP 公开路径（`index.html`、`vendor/`、`client/`、`admin/`）。

#### `storage.sqlite.engine`

- **默认值**：`auto`
- **类型**：`auto` | `node` | `better-sqlite3`
- **说明**：`auto` 在 Node 22.5+ 使用内置 `node:sqlite`，否则尝试 `better-sqlite3`。

#### `storage.sqlite.retentionDays`

- **默认值**：`30`
- **类型**：`1`–`3650` 的整数，或 `null` / `forever`
- **说明**：按消息 `created_at` 保留最近 N 天。永久留存必须写 `null` 或 `forever`。**禁止用 `0` 表示永久或关闭。**

单进程使用：不要让两个 Pavilo 实例共享同一个 db 文件。YAML 删除频道不会 DROP 库里的旧行。

维护命令（**先停服**再 restore）：

```bash
npm run storage -- backup --out ./data/backup.db
npm run storage -- integrity
npm run storage -- stats
npm run storage -- restore --from ./data/backup.db   # 目标已存在则拒绝
npm run storage -- restore --from ./data/backup.db --force
```

---

### `identity` —— 宿主身份

未写 `identity` 时与 v1.3 相同：任何人凭用户名进 `access: open` 的频道。产品示例放在 SQLite 家族里：复制 [`pavilo.sqlite.example.yaml`](../pavilo.sqlite.example.yaml)，按注释打开 `identity` 与 `staff` 频道。对照 [`examples/host-identity/`](../examples/host-identity/)。密钥不能与 `operator.token` 相同，也不进 `/room-info`。

```yaml
identity:
  guests: true
  audience: pavilo
  clockSkewSec: 60
  issuers:
    - id: app
      alg: HS256
      secret: ""   # 或 PAVILO_IDENTITY_SECRET
```

- **`guests`**：默认 `true`。`false` 时 join 必须带合法 `identityToken`。
- **`audience`**：JWT `aud`，须完全一致。
- **`issuers`**：v1.4 最多 1 项，算法钉死 `HS256`，不信任 token 头里的 `alg`。`secret` 至少 32 字符。
- **join**：Protocol v4 可选字段 `identityToken`。claims：`iss`、`aud`、`exp`、`sub`、可选 `name`、`channels`（授权的预建频道 id 数组）。TTL 建议不超过 15 分钟。

---

### `operator` —— 管理页口令（`version: 2` + sqlite）

模型渠道和 API key **只在 `/admin` 配置**，不要写进 YAML。管理页在「sqlite + 有效 token」时打开；否则 `/admin` 为 404。

sqlite 而未填 token 时服务**仍会启动**（聊天可用），但启动日志和 `npm run config:check` 会提示无法打开管理页。生成口令：

```bash
openssl rand -hex 32
```

```yaml
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
operator:
  token: ""    # 或环境变量 PAVILO_OPERATOR_TOKEN
```

#### `operator.token`

- **默认值**：空字符串
- **类型**：字符串，16–256 个可见 ASCII 字符，不能含空白
- **说明**：管理页登录口令，不是账号系统。推荐 `openssl rand -hex 32`。也用于派生 SQLite 里渠道 API key 的加密密钥（AES-256-GCM）。**更换 token 后必须在管理页重新填写渠道 key。** YAML 里没有 `operator.enabled`：有 sqlite 且 token 足够长才会打开 `/admin`。

渠道字段、preset、探测与 `complete()` 见 [gateway.md](gateway.md)。后台分层（语亭壳 / 房间与聊天频道 / AI 网关模块）见 [admin.md](admin.md)。

---

### `server` —— 服务器配置

#### `server.host`

```yaml
server:
  host: 0.0.0.0
```

- **默认值**：`0.0.0.0`
- **类型**：字符串
- **说明**：监听地址
  - `0.0.0.0` —— 允许局域网内其他设备访问（推荐用于团队协作）
  - `127.0.0.1` —— 仅允许本机访问（更安全，适合单人使用或开发）

#### `server.port`

```yaml
server:
  port: 4173
```

- **默认值**：`4173`
- **类型**：整数
- **说明**：监听端口，可被环境变量 `PORT` 覆盖
- **示例**：`PORT=8080 npm start`

#### `server.maxUsers`

```yaml
server:
  maxUsers: 64
```

- **默认值**：`64`
- **类型**：整数
- **说明**：全局最大用户数，**包含活跃用户和断线租约期内可恢复身份的用户**
- **约束**：各频道的 `maxUsers` 不得超过此值

#### `server.maxConnections`

```yaml
server:
  maxConnections: 80
```

- **默认值**：`80`
- **类型**：整数
- **说明**：最大 WebSocket 连接数。未加入聊天的连接也会占用此配额
- **建议**：通常设置为 `maxUsers` 的 1.2–1.5 倍，为连接建立和恢复留出缓冲

#### `server.maxConnectionsPerIp`

```yaml
server:
  maxConnectionsPerIp: 12
```

- **默认值**：`12`
- **类型**：整数
- **说明**：单个 IP 最大连接数，防止单一来源占用过多连接
- **注意**：反向代理环境下可能所有用户显示为同一 IP，此时该限制会**按代理 IP 聚合**（当前版本不信任 `X-Forwarded-For`）

#### `server.allowNoOrigin`

```yaml
server:
  allowNoOrigin: true
```

- **默认值**：`true`
- **类型**：布尔值
- **说明**：是否允许不带 `Origin` 头的 WebSocket 连接
  - `true` —— 允许命令行工具、某些代理客户端连接（为兼容性而设）
  - `false` —— 仅允许浏览器等带 Origin 的标准客户端（更安全）
- **建议**：可信网络内可用 `true`；公网部署建议 `false`

#### `server.allowedOrigins`

```yaml
server:
  allowedOrigins:
    - https://chat.example.com
    - https://team.example.com
```

- **默认值**：`[]`（空列表）
- **类型**：字符串数组
- **说明**：允许的跨域 Origin 列表（不含路径）。同源请求始终允许，无需配置
- **用途**：反向代理场景列出外部域名
- **重要**：这只校验 WebSocket 的浏览器 Origin，**不是用户认证或访问控制**，也不是谁可以把页面嵌进 iframe

#### `embed.ancestors`

```yaml
embed:
  ancestors:
    - http://127.0.0.1:4174
    - http://localhost:4174
```

- **默认值**：省略或空数组。此时没有 `/embed`，所有页面仍带 `X-Frame-Options: DENY`
- **类型**：字符串数组，最多 16 个。每项是不含路径的 `http://` 或 `https://` 源。拒绝通配
- **版本**：Schema v1 和 v2 都可以写。不要求 SQLite
- **说明**：这些源可以用 iframe 打开 `/embed` 和已启用玩法的页面。`/` 和 `/admin` 仍然拒绝被嵌。这张名单不代替 `server.allowedOrigins`：嵌入页自己连接 WebSocket，Origin 是 Pavilo
- **状态**：已随 v1.6.0 发布。消息桥字段见 [v1.6 设计](v1.6-design.md) 与 [examples/host-embed/](../examples/host-embed/)

#### `embed.direct`

```yaml
embed:
  direct: true
```

- **默认值**：`false`。省略时，没有 `ancestors` 就没有 `/embed`
- **类型**：布尔值
- **版本**：Schema v1 和 v2 都可以写。不要求 SQLite
- **说明**：为 `true` 时，App 可以用 WebView 顶层打开 `/embed`。响应仍是 `X-Frame-Options: DENY`，任何网页都不能嵌它。和 `ancestors` 同时写时，列出的源可以嵌，其他源不行。小程序不在当前接入范围
- **状态**：从 v1.7.0 起。v1.6.0 没有这项。用法见 [接入说明](integrate.md)

---

### `room` —— 房间配置

#### `room.title`

```yaml
room:
  title: 语亭 · 临时频道
```

- **默认值**：`语亭 · 临时频道`
- **类型**：字符串
- **说明**：房间标题，显示在浏览器标签页和页面顶部

#### `room.defaultChannel`

```yaml
room:
  defaultChannel: general
```

- **默认值**：`general`
- **类型**：字符串
- **说明**：用户加入时未指定频道则进入此频道
- **约束**：
  - 必须存在于 `channels` 列表中
  - 必须 `enabled: true`
  - **不能**是 `readOnly: true` 的频道

#### `moderation.ipDenyList`

```yaml
version: 2
moderation:
  ipDenyList:
    - 192.0.2.8
```

- **默认值**：`[]`
- **类型**：字符串数组，最多 64 条精确 IPv4 / IPv6（不做 CIDR）
- **说明**：这些地址不能 `join`。已在亭里的匹配连接会被请离。Schema v1 不能写这一段。
- **注意**：IP 取自 socket 对端，当前版本不信任 `X-Forwarded-For`。反向代理后拉黑一条可能挡住所有走同一出口的人。值班台人员页保存后认领 `moderation` 段，规则见 [admin.md](admin.md)。

#### `moderation.userDenyList`

```yaml
version: 1
moderation:
  userDenyList:
    - user-1
```

- **默认值**：`[]`
- **类型**：字符串数组，最多 64 条。每条是宿主 `sub`，字符集 `[A-Za-z0-9._:-]`，长度 1–128
- **说明**：这些稳定身份不能 `join`，已在亭里的匹配席位会以 `4011 / user_denied` 离开。访客和玩法席没有 `userKey`，不受影响。这不是会员目录
- **版本**：Schema v1 和 v2 都可以写。v1 不能同时写 `ipDenyList`。值班台保存 IP 名单或这份名单时，两份一起认领 `moderation` 段

#### `room.exposeMemberIps`

```yaml
room:
  exposeMemberIps: true
```

- **默认值**：`true`
- **类型**：布尔值
- **说明**：是否向频道成员显示彼此的 IP 地址
  - `true` —— 显示 IP（当前产品默认行为，适合可信局域网）
  - `false` —— 隐藏 IP（更注重隐私，但仍用于连接限制）

#### `room.exposeLanUrls`

```yaml
room:
  exposeLanUrls: true
```

- **默认值**：`true`
- **类型**：布尔值
- **说明**：是否在 `/room-info` 接口暴露局域网地址
  - `true` —— 列出主机所有局域网 IP，方便分享给同网段用户
  - `false` —— 返回空数组，不暴露主机网络位置

#### `room.defaultLanguage`

```yaml
room:
  defaultLanguage: zh-CN
```

- **默认值**：`zh-CN`
- **类型**：字符串
- **说明**：首次访问时的默认界面语言。用户可在页面内切换，选择会写入 `localStorage`（键名 `pavilo.language`），之后以本地选择为准
- **取值**：只能是 `zh-CN` 或 `en`
- **公开投影**：`/room-info` 同时返回 `defaultLanguage` 与固定的 `supportedLanguages: ["zh-CN", "en"]`

---

### `channels` —— 频道配置

```yaml
channels:
  - id: general
    name: 闲聊
    description: 轻松聊聊，只留当下。
    enabled: true
    maxUsers: 64
```

提供此数组会**完整替换**内置默认频道（`general` 和 `project`）。不提供则使用内置默认频道，其 `maxUsers` 会自动收紧到 `server.maxUsers`。

#### `channels[].id`

- **必填**
- **类型**：字符串
- **说明**：频道标识符，用于配置引用与界面展示

#### `channels[].name`

- **必填**
- **类型**：字符串
- **说明**：频道显示名称

#### `channels[].description`

- **类型**：字符串
- **说明**：频道描述，显示在频道列表与频道头部

#### `channels[].enabled`

- **类型**：布尔值
- **说明**：频道是否可加入。`false` 的频道**完全不可加入**
- **用途**：临时关闭频道而不必从配置中删除

#### `channels[].maxUsers`

- **类型**：整数
- **说明**：单频道成员上限，**不得超过 `server.maxUsers`**
- **注意**：包含断线租约期内仍可恢复身份的成员

#### `channels[].readOnly`

- **默认值**：`false`
- **类型**：布尔值
- **说明**：只读频道。频道**仍可进入、可浏览历史、可用表情回应**，但**所有人都不能发消息**——没有例外，也没有管理员豁免
- **用途**：公告、规则等由部署者维护的内容，通过 `welcome` 提供
- **UI 表现**：界面显示只读标识，输入框被禁用

#### `channels[].welcome`

- **类型**：字符串（支持多行）
- **说明**：频道顶部显示的导言卡，介绍频道用途、规则或玩法
- **约束**：所有频道的 `welcome` 总字节数有上限，超出会被拒绝

#### `channels[].access`

- **默认值**：`open`
- **类型**：`open` 或 `authenticated`
- **说明**：`open` 允许访客（若 `identity.guests` 不为 `false`）；`authenticated` 只接受宿主 JWT 且 `channels` 声明含该 id 的用户。未认证的 `/room-info` 不列出 `authenticated` 频道
- **约束**：出现 `authenticated` 时必须配置可用的 `identity.issuers`。访客开启时，默认频道必须是 `open`

#### `channels[].features`

- **默认值**：六项均为 `true`
- **键**：`images`、`replies`、`reactions`、`mentions`、`typing`、`history`
- **说明**：省略视为打开。关闭后服务端拒绝对应命令（`FEATURE_DISABLED`）；`typing` 关闭时静默丢弃。关 `history` 时 join 快照不带历史，也不提供 `historyPage`
- **注意**：隐藏 UI 不等于放行。值班台保存频道目录时会原样带回这些字段，v1.4 页面不提供开关

#### `channels[].play`（`version: 2` + sqlite）

- **类型**：字符串（playId）
- **说明**：把该频道绑到已启用的玩法。进入频道会打开 `/plays/<playId>/?channel=<id>`，而不是聊天页
- **约束**：必须出现在根键 `plays` 里，且 `storage.driver: sqlite`。`version: 1` 出现此字段会启动失败
- **完整约定**：[`docs/play.md`](play.md)

#### 频道最低要求

至少要启用一个**可发言**的频道（`enabled: true` 且 `readOnly` 不为 `true`）。只读频道可以浏览，但**不计入**"可发言"的最低要求。

---

### `limits` —— 容量与尺寸限制

#### `limits.maxMessagesPerChannel`

```yaml
limits:
  maxMessagesPerChannel: 300
```

- **默认值**：`300`
- **类型**：整数
- **说明**：每个频道最多保留的消息条数，超过后按 FIFO 淘汰最旧消息

#### `limits.maxTextLength`

```yaml
limits:
  maxTextLength: 2000
```

- **默认值**：`2000`
- **类型**：整数
- **说明**：单条文本消息最大字符数
- **建议**：`1000`–`4000`

#### `limits.maxImageBytes`

```yaml
limits:
  maxImageBytes: 300000
```

- **默认值**：`300000`（约 300 KB）
- **类型**：整数
- **说明**：单张图片最大字节数（**Base64 编码后**）
- **重要**：此值直接决定频道能保留多少张图片
  - 300 KB 时约能保留 79 张图（基于 32 MB 频道预算）
  - 1.5 MB 时只能保留约 16 张图
- **注意**：客户端会自动将图片长边降到 1600 px，手机照片通常远小于此上限；**GIF 不做降采样**，可能因此被拒绝

#### `limits.maxImageDimension`

```yaml
limits:
  maxImageDimension: 1600
```

- **默认值**：`1600`
- **类型**：整数
- **说明**：图片单边最大像素。**仅约束不降采样的 GIF**；普通图片（PNG/JPEG/WebP）会被客户端统一降到 1600 px

#### `limits.maxImagePixels`

```yaml
limits:
  maxImagePixels: 4000000
```

- **默认值**：`4000000`
- **类型**：整数
- **说明**：上传图片解码前的最大像素总数，限制单次上传的内存开销，防止超大图片导致崩溃
- **参考**：4,000,000 像素 ≈ 2000×2000 或 2500×1600

#### `limits.maxJsonBytes`

```yaml
limits:
  maxJsonBytes: 524288
```

- **默认值**：`524288`（512 KB）
- **类型**：整数
- **说明**：单个 JSON 消息最大字节数，必须能容纳最大图片的 Base64 + 消息元数据
- **建议**：至少是 `maxImageBytes` 的 1.5–2 倍

#### `limits.maxWebSocketFrameBytes`

```yaml
limits:
  maxWebSocketFrameBytes: 1572864
```

- **默认值**：`1572864`（1.5 MB）
- **类型**：整数
- **说明**：WebSocket 单帧最大字节数，必须能容纳最大 JSON 消息 + 协议开销
- **建议**：`maxJsonBytes` 的 1.2–1.5 倍

#### `limits.maxChannelBytes`

```yaml
limits:
  maxChannelBytes: 33554432
```

- **默认值**：`33554432`（32 MB）
- **类型**：整数
- **说明**：每个频道最大总字节数（所有消息 JSON 之和），超过后按 FIFO 淘汰最旧消息
- **参考**：32 MB 可存约 100–300 条混合消息（文字 + 图片）

#### `limits.maxWritableBytes`

```yaml
limits:
  maxWritableBytes: 2097152
```

- **默认值**：`2097152`（2 MB）
- **类型**：整数
- **说明**：单个慢连接的最大写缓冲，超过此值的慢连接会被断开，防止拖慢整个服务

#### `limits.maxDedupeEntries`

```yaml
limits:
  maxDedupeEntries: 512
```

- **默认值**：`512`
- **类型**：整数
- **说明**：消息去重缓存最大条目数，用于防止网络重传导致的重复消息
- **建议**：预期并发用户数 × 8–16

---

### `timeouts` —— 超时配置（单位：毫秒）

#### `timeouts.joinMs`

```yaml
timeouts:
  joinMs: 12000
```

- **默认值**：`12000`（12 秒）
- **类型**：整数
- **说明**：WebSocket 连接建立后多久内必须发送 `join` 命令，超时未加入会被断开
- **建议**：慢速网络可适当增大

#### `timeouts.heartbeatIntervalMs`

```yaml
timeouts:
  heartbeatIntervalMs: 30000
```

- **默认值**：`30000`（30 秒）
- **类型**：整数
- **说明**：服务端每隔此时间向客户端发送 ping

#### `timeouts.heartbeatTimeoutMs`

```yaml
timeouts:
  heartbeatTimeoutMs: 75000
```

- **默认值**：`75000`（75 秒）
- **类型**：整数
- **说明**：客户端在此时间内未响应 pong 则被视为断线
- **建议**：`heartbeatIntervalMs` 的 2–3 倍

#### `timeouts.typingTtlMs`

```yaml
timeouts:
  typingTtlMs: 4000
```

- **默认值**：`4000`（4 秒）
- **类型**：整数
- **说明**：用户停止输入后，此时间后自动取消"正在输入"状态

#### `timeouts.sessionLeaseMs`

```yaml
timeouts:
  sessionLeaseMs: 15000
```

- **默认值**：`15000`（15 秒）
- **类型**：整数
- **说明**：意外断线（非主动离开）后，用户身份和名称保留此时间。期间可用原 token 恢复；过期后释放名额并广播离开
- **注意**：设为 `0` 表示断线立即释放（**不推荐**，影响刷新体验）。租约期内的成员**仍占用**全局与频道人数配额

#### `timeouts.dedupeTtlMs`

```yaml
timeouts:
  dedupeTtlMs: 600000
```

- **默认值**：`600000`（10 分钟）
- **类型**：整数
- **说明**：消息去重缓存保留时间，超过此时间的去重记录会被清理
- **建议**：5–10 分钟，覆盖典型的网络波动周期

---

### `rateLimits` —— 频率限制

#### `rateLimits.windowMs`

```yaml
rateLimits:
  windowMs: 5000
```

- **默认值**：`5000`（5 秒）
- **类型**：整数
- **说明**：限流时间窗口。在此窗口内，每个连接最多发送以下数量的命令

#### `rateLimits.messages`

```yaml
rateLimits:
  messages: 8
```

- **默认值**：`8`
- **类型**：整数
- **说明**：时间窗口内最多发送的消息数（**包含文本和图片消息**）
- **建议**：5–20 条

#### `rateLimits.reactions`

```yaml
rateLimits:
  reactions: 20
```

- **默认值**：`20`
- **类型**：整数
- **说明**：时间窗口内最多发送的回应（reaction）数
- **建议**：20–50 次

#### `rateLimits.typing`

```yaml
rateLimits:
  typing: 12
```

- **默认值**：`12`
- **类型**：整数
- **说明**：时间窗口内最多发送的输入状态更新数
- **建议**：10–15 次

---

## 跨字段约束

配置校验会检查以下关系，违反会导致启动失败：

- 各频道 `maxUsers` 不得超过 `server.maxUsers`
- `room.defaultChannel` 必须存在、已启用，且**不是**只读频道
- 至少启用一个可发言频道
- 最大 JSON 消息、最大 WebSocket 帧与写缓冲必须能相互容纳
- 全局最大人数对应的成员列表 JSON 必须能容纳在帧预算内

这些是**防止配置自相矛盾**的保守下限，**不是内存使用承诺**：提高人数、图片、历史或缓冲上限会显著增加内存需求。

---

## 调优建议

来自 `pavilo.example.yaml` 的推荐组合：

**小团队（< 10 人）**

```yaml
server:
  maxUsers: 16
  maxConnections: 24
limits:
  maxMessagesPerChannel: 200
  maxImageBytes: 500000
```

**中型团队（10–50 人）**

```yaml
server:
  maxUsers: 64
  maxConnections: 80
limits:
  maxMessagesPerChannel: 300
  maxImageBytes: 300000
```

**大型团队（50+ 人）**

```yaml
server:
  maxUsers: 128
  maxConnections: 160
limits:
  maxMessagesPerChannel: 500
  maxImageBytes: 200000
  maxChannelBytes: 67108864
```

**图片密集型场景**

```yaml
limits:
  maxImageBytes: 500000
  maxChannelBytes: 67108864
  # maxJsonBytes、maxWebSocketFrameBytes 需相应增加
```

**文本为主场景**

```yaml
limits:
  maxImageBytes: 150000
  maxMessagesPerChannel: 800
```

---

## 配置校验

```bash
# 校验实际会加载的配置，并显示配置来源
npm run config:check

# 校验指定文件
PAVILO_CONFIG=/etc/pavilo/config.yaml npm run config:check
```

常见校验失败：

| 现象 | 原因 |
| --- | --- |
| 启动即失败，提示未知键 | 使用了 schema 之外的字段名（拼写错误或凭空添加） |
| `defaultChannel` 相关错误 | 默认频道不存在、未启用，或是只读频道 |
| `maxUsers` 相关错误 | 频道上限超过 `server.maxUsers` |
| 容量相关错误 | 图片/JSON/帧/缓冲预算无法相互容纳 |
| 至少一个可发言频道的错误 | 所有频道都是 `readOnly` 或 `enabled: false` |

---

## 配置文件安全

Pavilo 的 HTTP 服务采用静态白名单，`pavilo.yaml`、`pavilo.example.yaml` 和 `pavilo.sqlite.example.yaml` **不会**被应用提供；配置加载器也拒绝把 `index.html`、`chat.css` 或 `vendor/`、`client/` 内文件（包括通过符号链接指向它们的文件）用作配置。

但这不是认证机制：聊天页面、房间元数据和前端资源对任何能访问监听端口的人开放。

- 不要把真实配置放入 `vendor/`、`client/`、其他 Web 根目录、对象存储公开目录或反向代理的静态目录
- 反向代理只能转发 Pavilo 的应用端口，不得额外把整个仓库目录作为静态站点
- 原始 YAML **不得提供下载**；如包含内部域名或网络策略，应放在仓库外并设置操作系统文件权限

---

## 参考资源

- [`pavilo.example.yaml`](../pavilo.example.yaml) —— 内存模式完整示例（`cp` 为 `pavilo.yaml`）
- [`pavilo.sqlite.example.yaml`](../pavilo.sqlite.example.yaml) —— SQLite 家族完整示例（留存、值班台；玩法与宿主身份为注释块）
- [故障排查指南](troubleshooting.md)
- [部署文档](deployment/)
- [HTTP API 文档](api/http-api.md)