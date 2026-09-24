# 接入说明

> 状态：这是交给**另一个项目的 Agent** 的契约。没有 npm 包，没有 SDK，没有框架组件。
>
> 网页 iframe 和 App 的 WebView 用同一份 **v1.7.0**。v1.6.0 只有 iframe 预览，不认 `embed.direct`，也不认地址 fragment，不要拿它接 App，也不要让两种壳各用一版。

Pavilo 不提供服务器。要聊天的人在自己的项目里把这个开源服务启动起来，再嵌进自己的网页或 App。Agent 不改 Pavilo 的源码，也不把聊天重写进对方的页面，也不自己连接 WebSocket。

图片、回复、历史、玩法这些开关留在对方自己这份 Pavilo 配置里。对方不用组装界面。

## 复制这一段

把下面整段交给对方项目里的 Agent。不要改字段名。外层围栏不用复制。

~~~~text
你正在把 Pavilo（语亭）接入当前仓库。Pavilo 是开源软件，没有人托管它。不要去找一个已经存在的 Pavilo 地址，也不要申请任何 Pavilo 账号。由当前项目自己把服务跑起来。

不要把 Pavilo 的源码复制进业务代码，不要改它的页面，不要 npm install pavilo，不要写聊天界面，不要自己连接 WebSocket，不要做 SDK 或组件包。

先找这个项目现有的登录。没有登录就停下来告诉开发者，不要新做一套账号。

再用这个项目已经在用的方式启动 Pavilo，和这个网站一起启动，不要另找一台别人的服务器：

- 项目已有 Docker Compose 时，加一个服务，镜像固定为 ghcr.io/caigg188/pavilo:1.7.0。网页 iframe 和 App 的 WebView 都用这一版。不要用 1.6.0。
- 没有容器时，把 https://github.com/caigg188/Pavilo.git 克隆到业务源码旁边的目录，检出 v1.7.0，在那个目录 npm ci 后 npm start。不要把克隆结果放进前端源码目录，也不要提交进去。
- 生成至少 32 个字符的 PAVILO_IDENTITY_SECRET，放进服务端环境变量。Pavilo 进程和这个网站的后端用同一把。不要写进前端，不要写进仓库。
- 写一份 pavilo.yaml 挂给这个进程。version 用 2，storage.driver 用 sqlite，这样聊天记录会留下。secret 写成空字符串，让环境变量覆盖。identity.guests 为 false，audience 为 pavilo，issuer id 为 app，alg 为 HS256。建一个频道，id 用 chat，access 为 authenticated。embed.ancestors 写成浏览器打开这个网站时的源（协议、主机、端口）。用 SQLite 时关掉容器的只读根文件系统，并挂上数据目录。
- PAVILO_URL 就是浏览器访问这个进程的源，不含路径。本地通常是 http://127.0.0.1:4173。端口被占用就换一个，并写进配置。不要向开发者索要一个外部地址。

PAVILO_CHANNEL 是 chat。PAVILO_ISSUER 是 app。PAVILO_AUDIENCE 是 pavilo。

密钥、JWT、operator token 禁止出现在前端包、日志、URL 的 ?query 和路径里。

服务端用现成的 JWT 库签 HS256，不要手写签名。header 的 alg 固定为 HS256。payload 只包含：

- iss：PAVILO_ISSUER
- aud：PAVILO_AUDIENCE
- sub：当前登录用户的稳定 id，字符集 [A-Za-z0-9._:-]，长度 1–128。不要用昵称当 sub
- name：显示名，可省略
- channels：字符串数组，至少包含 PAVILO_CHANNEL。只能填 Pavilo 里已经存在的频道，不要调用任何建频道接口
- iat：现在的秒
- exp：iat 加 600。不得超过 15 分钟

如果当前仓库是微信小程序或其他小程序，停下来告诉开发者：小程序不在这次接入范围内。不要加 web-view，不要接微信 JS-SDK。

按这个项目实际的壳选一种，不要两种都做：

1. 网页。加一个 iframe，src 是 PAVILO_URL + "/embed"，不要附带 token，不要加 sandbox。使用下面的 attachPaviloFrame，不要改字段名。signIdentity 每次 hello 都重新签发，不要把上一张凭证缓存到过期。收到 identity-expired 时不要拆掉 iframe，页面会再发 hello。embed.ancestors 用这个网站的源，不要把这个源写进 server.allowedOrigins。配置可以照仓库里的 examples/alongside，只改祖先和端口。用 SQLite 时关掉只读根文件系统并挂上数据目录。

2. iOS 或 Android 应用。用上面同一份 v1.7.0，不要另建一版。在 pavilo.yaml 写 embed.direct: true。用系统 WebView 打开：
   PAVILO_URL + "/embed?channel=" + PAVILO_CHANNEL + "#pavilo=" + encodeURIComponent(JWT)
   不要把 JWT 放进 ? 后面。不要写原生聊天界面。过期前重新加载这个地址，用一张新 JWT。正式环境用 https。

接上的标准：页面能发出一条文字消息并看到它出现，此时地址栏里已经没有 pavilo=，也没有整段 JWT。打不开时看页面文字或错误码 IDENTITY_REQUIRED、IDENTITY_INVALID、IDENTITY_EXPIRED、CHANNEL_FORBIDDEN。不要改成访客身份再试。

不要改 Pavilo 的功能开关。关掉的能力页面自己会藏起来。
~~~~

嵌页代码逐字如下，与 [examples/host-embed/frame.js](../examples/host-embed/frame.js) 相同：

```javascript
// 嵌进网页时逐字使用。每次 hello 都要换一张新凭证。不要在 identity-expired 时拆掉 iframe。
function attachPaviloFrame(iframe, paviloUrl, signIdentity) {
  const paviloOrigin = new URL(paviloUrl, window.location.href).origin;
  window.addEventListener('message', (event) => {
    if (!iframe || event.origin !== paviloOrigin || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.v !== 1 || data.source !== 'pavilo-embed' || data.type !== 'hello') return;
    Promise.resolve()
      .then(() => signIdentity())
      .then((session) => {
        if (!session || !session.identityToken || event.source !== iframe.contentWindow) return;
        iframe.contentWindow.postMessage({
          v: 1,
          source: 'pavilo-host',
          type: 'identity',
          instance: data.instance,
          channelId: session.channelId,
          username: session.username,
          identityToken: session.identityToken,
        }, paviloOrigin);
      })
      .catch(() => {});
  });
}
```

上面那段话要求 Agent 在对方自己的部署里写下面这种配置。文件可以留在对方仓库的部署目录，不要打进前端包。密钥用环境变量 `PAVILO_IDENTITY_SECRET`，不要写进文件。项目维护者不提供这台服务。

网页 iframe：

```yaml
embed:
  ancestors:
    - https://app.example.com
identity:
  guests: false
  audience: pavilo
  issuers:
    - id: app
      alg: HS256
      secret: ""
channels:
  - id: staff
    name: 内部
    access: authenticated
```

App 的 WebView 只允许顶层打开、不允许被任何网页嵌：

```yaml
embed:
  direct: true
```

两种都要时，`ancestors` 和 `direct: true` 写在一起。`direct: true` 不会放宽 `/` 和 `/admin`，这两处仍然拒绝被嵌。

## 契约

对方 Agent 只该依赖本节。消息桥不是 WebSocket 协议，不升 Protocol v4。

### 谁配置什么

| 侧 | 配置 | 不配置 |
| --- | --- | --- |
| 对方自己启动的 Pavilo | 频道、`access`、`features`、`identity`、`embed` | 对方的登录和界面；也不是 Pavilo 项目提供的服务器 |
| 对方服务端 | 签发 JWT，并和自己的网站一起启动 Pavilo | 修改 Pavilo 源码、自己连接 WebSocket |
| 对方前端 | iframe，或 App WebView 的地址 | WebSocket、聊天 DOM、小程序 |

省略 `embed` 时没有 `/embed`。这和 v1.6 相同。

### 打开方式

| 壳 | 地址 | 身份怎么进去 |
| --- | --- | --- |
| 网页 iframe | `{PAVILO_URL}/embed` | 父页面 `postMessage`，字段见下表 |
| App WebView | `{PAVILO_URL}/embed?channel={id}#pavilo={encodeURIComponent(jwt)}` | 只读 fragment。页面在画出来之前拿走，并用 `history.replaceState` 从地址栏删掉 |

`?channel=` 只放频道 id。`?pavilo=`、路径、Referer 都不算凭证。fragment 不会进服务器日志和 Referer。

玩法切换仍留在同一个网页容器里。下一页的地址会再次带上 fragment，到达后同样立刻删掉。不要自己打开 `/plays/...`。

没有父页面、也没有合法 fragment 时，页面停在等待，不降级成访客。

### JWT

与 [ADR-0010](adr/0010-host-identity.md) 相同。HS256，用配置里的算法验签，不信任 token 头里的 `alg`。`exp` 必填，寿命最长 15 分钟。`channels` 里的 id 必须已经存在。续期是再签一张，然后父页面再发 `identity`，或网页容器重新打开带新 fragment 的地址。没有 `refreshIdentity` 命令。

### 父页面消息

公共字段：`v: 1`。子页面 `source` 为 `pavilo-embed`，父页面 `source` 为 `pavilo-host`。

子页面发给父页面：`hello`、`ready`、`unread`、`connection`、`identity-expired`、`error`、`left`。载荷里没有凭证。

父页面发给子页面的只有 `identity`：`instance`、`channelId`、可选 `username`、可选 `identityToken`。`instance` 必须等于这个 iframe 最近一次 `hello`。

校验沿用 [v1.6 设计](v1.6-design.md) 第 4 节。网页示例是 [examples/host-embed/](../examples/host-embed/)。那个示例不是要复制进对方仓库的 SDK。

### 失败

| 代码 | 含义 |
| --- | --- |
| `IDENTITY_REQUIRED` | 这个亭不接受访客，而这次没有凭证 |
| `IDENTITY_INVALID` | 签错、iss/aud/sub/channels 不合法，或寿命超过 15 分钟 |
| `IDENTITY_EXPIRED` | 过期。页面停止重连，不改成访客 |
| `CHANNEL_FORBIDDEN` | 凭证有效，但 `channels` 里没有这个频道 |

### 不要做

- npm 包、类型声明、React/Vue 组件、App 原生聊天界面
- 微信小程序和其他小程序，包括 web-view 和微信 JS-SDK
- 把 JWT 放进 query、路径或日志
- 在 iframe 上加 `sandbox`
- 把宿主源写进 `server.allowedOrigins` 来代替 `embed.ancestors`。嵌入页自己连 WebSocket，Origin 是 Pavilo
- 动态建频道、多租户、替换 Pavilo 的页面结构
- 为了未读角标去改 Pavilo。网页 iframe 可以听 `unread`。App 这一版只保证能聊天
