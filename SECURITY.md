# 安全政策

## 支持的版本

Pavilo v1.x 的安全更新针对最新稳定版本。

| 版本 | 支持状态 |
| --- | --- |
| 1.x（最新发布） | ✅ 支持 |
| main | ✅ 支持（开发中） |
| 0.x | ❌ 不支持，请升级到 1.x |

v1.0 起，文档承诺的 Protocol v4 与 Config Schema v1 保持向后兼容。v1.1 增加可选 Config Schema v2（`storage`）；未写 `storage` 的 v1 文件行为不变。未承诺的内部实现仍可能在 minor 中调整。

## 安全假设与边界

Pavilo 当前默认仍设计用于**可信网络环境**（内网、VPN 或配置了适当访问控制的代理后）。最新稳定版是 v1.7.0。值班台人员治理管的是临时席位、举报和墓碑，不是会员名录；宿主 JWT 是可选接入端口。嵌入只对配置的宿主来源放开 iframe；`embed.direct` 只允许顶层打开。不发布接入 SDK，接入方式见 [接入说明](docs/integrate.md)。

### 当前安全边界

✅ **已实现的保护：**

- WebSocket Origin 检查（限制浏览器来源，不是用户认证；无 Origin 客户端由单独配置控制）
- 连接数限制（防止资源耗尽）
- 消息大小限制
- 图片解码校验
- Rate limiting（防止刷屏）
- WebSocket 协议校验

**v1.3–v1.5 已发布：**

- operator token 保护管理后台，与聊天会话分离
- 席位禁言、请离和 IP 黑名单；黑名单可在 YAML 配置，SQLite 后台可保存覆盖层
- Play 的私密状态投递和可信模块加载边界
- 可选宿主 JWT（`join.identityToken`）；operator token 不能当用户凭证
- 有值班台时的举报、墓碑式内容移除、`moderation.userDenyList` 和操作记录。见 [ADR-0011](docs/adr/0011-governance-loop.md)。内存模式不收举报。墓碑不是磁盘级清除
- 可选嵌入预览：只有 `embed.ancestors` 里的源可以嵌 `/embed` 和已启用玩法页。`embed.direct` 只允许顶层打开，仍然拒绝被嵌。`/` 与 `/admin` 仍是 `X-Frame-Options: DENY`。凭证可以短暂出现在 fragment，页面会立刻删除；不进 query。未配置时没有嵌入入口

❌ **当前尚未实现或需外部提供：**

- 自建注册/密码（独立页昵称仍不能证明宿主身份；宿主须自己签发 JWT）
- 提交前内容审核，包括词表、模型和视觉审核
- TLS/加密传输（需反向代理提供）
- 可信代理头（`X-Forwarded-For` 等）

### 适用场景

**当前适用的部署边界（仍需正确配置）：**
- 公司内网（有防火墙）
- Tailscale / WireGuard / Zerotier 等 VPN
- Nginx / Caddy 反向代理 + 基础认证
- 家庭局域网（信任所有设备）

❌ **不安全的使用场景：**
- 直接暴露到公网（无任何防护）
- 开放注册的公开聊天室
- 需要防御 DDoS / 刷单 / 爬虫

### 默认配置的安全考量

- `server.allowNoOrigin: true` — 当前默认允许没有 Origin 的客户端；可设置为 `false` 拒绝此类请求。Origin 限制仍不是身份认证
- `room.exposeMemberIps: true` — 默认显示 IP（适合可信环境）
- `room.exposeLanUrls: true` — 默认暴露局域网地址（方便分享）

可以减少元数据暴露的配置片段如下；它不是完整配置，也不足以单独提供公网访问控制：
```yaml
server:
  allowNoOrigin: false
room:
  exposeMemberIps: false
  exposeLanUrls: false
```

## 报告安全漏洞

### 如何报告

**请勿公开披露安全漏洞**。请通过以下方式私密报告：

1. **GitHub Security Advisory**（推荐）
   - 访问 https://github.com/caigg188/Pavilo/security/advisories
   - 点击 "New draft security advisory"

2. 不要在公开 Issue 中披露可利用细节。

### 报告应包含

- 漏洞描述（CVSS 评级，如果可能）
- 复现步骤（越详细越好）
- 影响范围（哪些版本受影响）
- 是否有公开的 PoC 或讨论
- 你的联系方式

### 响应时间

我们会在收到报告后尽快响应：
- **24 小时内**：确认收到报告
- **7 天内**：评估严重性并给出初步反馈
- **30 天内**：发布修复（根据严重程度加急）

### 披露政策

- 修复发布后，我们会公开致谢报告者（除非你要求匿名）
- 披露时间表由严重性决定：
  - **Critical / High**：立即私密修复，发布后公开
  - **Medium / Low**：在下一个版本中修复

## 已知限制与不承诺修复的问题

以下是产品设计导致的已知限制，**不视为安全漏洞**：

### 1. 无用户认证

任何能访问监听端口的人都可以加入聊天室。

**缓解措施：**
- 使用反向代理 + 基础认证
- 使用 VPN 限制访问
- 宿主身份与频道授权已随 v1.4 发布，但默认部署仍是无账号的访客模式。未配置 `identity` 时，不要把它当成已经打开的访问控制

### 2. 用户名可伪造

用户可以使用任何用户名（除非该名称已被占用）。

**缓解措施：**
- 在可信环境使用（团队内网）
- IP 可辅助排查，但不能作为用户身份凭据，代理后还可能仅看到代理 IP

### 3. 资源限制不是完整滥用防护

当前有消息、互动等限流和全局/单 IP 连接上限；这不等于完整公网反滥用或 DDoS 防护。

**缓解措施：**
- 使用反向代理的速率限制
- 结合实际代理、容量和网络环境验证，未来可信代理和治理基线按路线图推进

### 4. 内存中的临时数据

默认 memory 模式的消息只存在进程内存中，服务重启后清空。SQLite 模式按留存策略持久化消息和回应；在线状态和临时会话仍不跨进程恢复。

**这不是 Bug，而是产品设计（Ephemeral First）。**

### 5. IP 地址暴露

默认配置下，频道内成员可以看到彼此的 IP。

**缓解措施：**
- 设置 `room.exposeMemberIps: false`
- 使用反向代理（所有人显示为代理 IP）

## 依赖项安全

Pavilo 的必需 runtime 依赖为 `yaml`，另有可选 SQLite 驱动 `better-sqlite3`；前端自托管资源同样需要纳入依赖审查。

我们会：
- 定期检查依赖项的安全公告
- 在发现漏洞后尽快更新
- 在 CHANGELOG 中注明安全相关的依赖更新

运行 `npm audit` 检查已知漏洞。

## 安全最佳实践

### 部署建议

1. **使用反向代理**
   ```nginx
   # Nginx 示例
   location / {
       proxy_pass http://localhost:4173;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       
       # 基础认证
       auth_basic "Restricted Access";
       auth_basic_user_file /etc/nginx/.htpasswd;
   }
   ```

2. **启用 HTTPS**
   - 使用 Let's Encrypt 免费证书
   - Pavilo 本身不处理 TLS，由反向代理提供

3. **限制访问源**
   ```nginx
   # 只允许特定 IP 段
   allow 192.168.1.0/24;
   deny all;
   ```

4. **定期更新**
   ```bash
   git pull origin main
   npm install
   npm test
   # 重启服务
   ```

### 配置建议

```yaml
# 生产环境最小暴露配置
version: 1

server:
  host: 127.0.0.1  # 只监听本地，通过反向代理暴露
  allowNoOrigin: false
  maxUsers: 32
  maxConnections: 40

room:
  exposeMemberIps: false
  exposeLanUrls: false
```

### 监控建议

- 监控 `/healthz` 端点（连接数、消息数）
- 设置告警：连接数接近上限
- 定期查看日志：异常重连、错误率

## 路线图

未来版本的安全增强计划（尚未实现，不构成当前部署保证）：

- **v1.4**：宿主身份、频道授权、服务端能力开关；保留可选访客。已发布。
- **v1.5**：举报、墓碑移除、稳定用户拒绝、操作记录。已发布。不含嵌入，也不含提交前审核。
- **v1.6**：嵌入预览。已发布。浏览器检查改为阻塞发布。不是 SDK。这一版没有 `embed.direct`，也不认 fragment。
- **v1.7**：一段话接入。已发布。不发布 SDK。通用 Policy 端口、视觉审核和提交前词表更晚，而且词表不是这一版的门槛。

具体做法见 [接入说明](docs/integrate.md)。嵌入只对指定入口开放来源；`embed.direct` 不允许被嵌。后台继续禁止嵌入。凭证不进 query，不依赖第三方 Cookie。签名、签发者、受众、有效期和退出/续期需要验证。权限覆盖频道发现、历史和操作，不能只鉴权首页。

审核拒绝或超时不得产生成功 ACK；严格审核模式失败拒绝，临时场景可显式选择放行。Agent 公开消息走统一权限、限额与审核路径。扩展是部署者信任的代码，不承诺恶意代码、无限循环或进程退出的隔离。

持久社区的治理记录使用 SQLite；临时模式保持临时边界。TLS 仍可由反向代理终止，宿主身份不能替代传输保护和资源限制。端到端加密、完整账号系统与沙箱不作为 v2.0 目标。

## v1.0 安全自查

对照当前产品边界（可信网络、无账号、无 TLS）做过一次收口，不是完整渗透测试：

- Origin 检查、连接数/帧/JSON/图片预算、消息与回应限流仍是默认防护
- 静态白名单不提供配置文件与源码
- 协议解析只走 v4，旧版本不再扩大攻击面
- `npm audit` 进入 CI（`--audit-level=high`）
- 不承诺把裸端口直接暴露到公网；TLS 与访问控制仍由反向代理 / VPN 提供

## 联系方式

- **安全问题**：https://github.com/caigg188/Pavilo/security/advisories
- **一般问题**：GitHub Issues
- **架构讨论**：GitHub Discussions

---

感谢你帮助 Pavilo 保持安全！🔒
