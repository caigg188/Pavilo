# 贡献指南

Pavilo 正从独立临时聊天室演进为可组装、可嵌入的聊天能力。维护者建设基础设施与完整参考，社区按契约开发玩法和扩展；目标用户包括独立使用者、个人开发者和小型社区。先阅读 [路线图](ROADMAP.md) 和 [接入说明](docs/integrate.md)。不发布 SDK。 [集成设计](docs/integration.md) 里的 SDK 表不能当接口实现。

感谢你对 Pavilo 的关注！本文档将帮助你了解如何为项目做出贡献。

## 目录

- [行为准则](#行为准则)
- [开始之前](#开始之前)
- [开发环境](#开发环境)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [代码审查清单](#代码审查清单)
- [测试要求](#测试要求)
- [贡献玩法](#贡献玩法)
- [架构原则](#架构原则)

---

## 行为准则

Pavilo 致力于为所有贡献者提供友好、尊重的环境。请遵循基本的开源社区礼仪：

- 尊重不同观点和经验
- 优雅地接受建设性批评
- 关注对社区最有利的事情
- 对他人表示同理心

## 开始之前

### 适合新手的任务

查找标记为 `good first issue` 的 Issue，这些是相对独立、明确的小任务。

### 重大变更

如果你计划实现重大功能或架构变更，**请先开 Issue 讨论**，并先对照 [路线图](ROADMAP.md) 与 [集成设计（规划中）](docs/integration.md)：
- 这是当前缺口、v1.3 已发布契约，还是 v2.0 规划？
- 是否落在路线图「明确暂缓」范围？
- 描述问题和你的解决方案
- 等待维护者反馈后再投入大量时间编码

这样可以避免你的 PR 因为与产品方向不符而被拒绝。规划中的接口不要按旧 ADR 示例直接调用。

## 开发环境

### 要求

- **Node.js**: 22+
- **操作系统**: macOS / Linux / Windows (WSL2)
- **浏览器**: Chrome / Edge（用于浏览器测试）

### 安装

```bash
git clone https://github.com/caigg188/Pavilo.git
cd Pavilo
npm install
```

### 运行

```bash
# 启动服务（默认 http://localhost:4173）
npm start

# 运行单元测试和集成测试
npm test

# 运行浏览器验收测试
npm run test:browser

# 校验配置示例
npm run config:check
```

### 目录结构

```
.
├── config.js            # 配置加载与校验
├── server.js            # 服务入口（composition root）
├── src/
│   ├── core/           # 核心逻辑（不依赖网络）
│   ├── storage/        # ConversationStore（默认 memory）
│   ├── transport/      # HTTP / WebSocket 适配器
│   ├── gateway/        # 进程内 AI 网关（可选，默认关闭）
│   ├── operator/       # 值班台鉴权与配置覆盖层
│   └── play/           # Play/Agent 宿主
├── admin/              # 值班台页面
├── client/             # 前端模块
├── plays/              # echo 夹具；官方狼人杀仍为规划
├── test/               # Node.js 测试
└── docs/               # 当前契约、目标边界与 ADR
```

### 架构文档

在修改代码前，请先阅读：
- [架构原则](docs/architecture/principles.md) — 核心不变量与设计哲学
- [架构演进](docs/evolution.md) — 目标边界，不是当前教程
- [集成设计（规划中）](docs/integration.md) — 宿主身份、组装与嵌入 SDK
- [架构决策记录](docs/adr/) — 重大技术决策的背景
- [产品路线图](ROADMAP.md) — 已发布 / 主分支已实现 / 计划中
- [v1.3 收口清单](docs/v1.3-closeout.md) — 把主分支能力收成 v1.3 的工作文档

## 提交规范

Pavilo 使用约定式提交（Conventional Commits）格式：

```
<type>(<scope>): <中文说明>

[可选的详细描述]
```

### Type（类型，英文）

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档变更
- `style`: 代码格式（不影响功能）
- `refactor`: 重构（不改变外部行为）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链变更

### Scope（模块，英文）

- `core`: src/core/
- `storage`: src/storage/
- `transport`: src/transport/
- `client`: client/
- `config`: 配置相关
- `room`: 房间逻辑
- `session`: 会话管理
- `protocol`: 协议变更
- `play`: 玩法契约或官方/社区玩法
- `gateway`: AI 网关
- `adr`: ADR 文档

### 示例

```bash
git commit -m "feat(room): 支持只读频道"
git commit -m "fix(client): 修复断线重连后消息重复"
git commit -m "docs(adr): 新增 SQLite driver 选型决策"
git commit -m "refactor(core): 提取 ConversationStore 接口"
```

### BREAKING CHANGE

如果提交包含不兼容变更，在提交信息中说明：

```
feat(protocol): 删除 Protocol v1/v2/v3 支持

BREAKING CHANGE: 服务端只接受 Protocol v4 客户端。
旧客户端连接时返回 PROTOCOL_NOT_SUPPORTED 并以 1002 关闭。
```

## Pull Request 流程

### 1. Fork 并创建分支

```bash
git checkout -b feat/your-feature-name
```

分支命名：
- `feat/feature-name` — 新功能
- `fix/bug-description` — Bug 修复
- `docs/what-changed` — 文档更新

### 2. 开发与测试

- 编写代码
- 添加测试（如果是新功能或 Bug 修复）
- 确保 `npm test` 通过
- 确保 `npm run config:check` 通过
- 如果修改了前端，手动验证浏览器行为

### 3. 提交变更

```bash
git add -A
git commit -m "feat(scope): 中文说明"
```

### 4. 推送并创建 PR

```bash
git push origin feat/your-feature-name
```

在 GitHub 上创建 Pull Request，填写：
- **标题**：与提交信息一致
- **描述**：
  - 解决了什么问题？
  - 如何测试？
  - 是否有 Breaking Change？
  - 相关 Issue 编号（如 `Closes #123`）

### 5. 代码审查

维护者会审查你的代码。可能的结果：
- ✅ 批准并合并
- 💬 请求修改（回复评论后重新提交）
- ❌ 拒绝（说明原因）

## 代码审查清单

每个 PR 合并前必须回答这 7 个问题（来自 [架构原则](docs/architecture/principles.md)）：

1. **默认临时用户是否被迫承担新的依赖或复杂度？**
   - 新功能是否默认关闭？未启用时是否增加默认负担？
2. **能力和权限是否由服务端执行，依赖是否可验证？**
   - 关闭后绕过 UI 是否仍被拒绝？
3. **核心、网络、存储、厂商调用与玩法规则的边界是否清楚？**
   - WebSocket handler 是否只做协议解析？adapter 是否绕过 core 写状态？
4. **身份变化、审核等待、提交失败、重启和超限的行为是否明确？**
   - 时钟、ID、外部 IO 是否可在测试中替换？
5. **人与 Agent 是否走统一治理路径，私密状态是否按接收者隔离？**
6. **公共契约、兼容与迁移是否有对应测试？**
7. **当前实现、规划、配置示例和中英文入口是否一致？**
   - 已实现字段才写入可运行示例；规划字段只进入设计文档。

玩法相关 PR 额外对照 [docs/play.md](docs/play.md)：页面是否独立、是否走 `playAction`、浏览器是否调用了网关。

## 测试要求

### 测试金字塔

Pavilo 的测试遵循以下层次（从多到少）：

1. **Core Unit Tests**（最多）
   - 纯函数、命令处理、状态变更
   - 注入时钟、ID 生成器
   - 不启动网络服务
   - 快速（<1s）

2. **Contract Tests**（中等）
   - Protocol 解析器
   - Config Schema
   - Store 接口

3. **Transport Integration Tests**（较少）
   - WebSocket 握手
   - 真实网络

4. **Browser Acceptance Tests**（最少）
   - 双用户消息流
   - 真实浏览器

### 新功能的测试要求

- **新命令/状态变更** → Core Unit Test（必须）
- **新配置字段** → Config 解析测试（必须）
- **Protocol 变更** → Contract Test（必须）
- **UI 变更** → 手动验证（必须）+ Browser Test（可选）

### 运行测试

```bash
# 运行所有 Node.js 测试
npm test

# 运行特定测试文件
node --test test/core.test.js

# 运行浏览器测试（需要 Playwright）
npm run test:browser
```

## 贡献玩法

Pavilo 主线负责 **AI 网关**、**Play 宿主** 和一层薄契约。官方样例是文字狼人杀（状态机 + **自己的页面**），目前仍为规划，与基础设施并行，不作为 v1.7 门槛，v2.0 前交付。启用一套玩法模块，再把频道的 `play` 指过去；进入该频道即加载玩法页，不要改聊天气泡流。对照夹具是 [`plays/echo/`](plays/echo/)。

请先读 [docs/play.md](docs/play.md) 和 [ADR-0006](docs/adr/0006-play-contract.md)。不要提交「通用游戏平台」或往 `chat.css` 里塞玩法按钮。

社区玩法默认只改 `plays/<id>/`。契约不够用先开 Issue，不要在玩法 PR 里默默改信封。

官方合作开发者（实现官方狼人杀时包括 111pointer111）可以在真实缺口上优化 Play 宿主、`playAction` / `playState` 信封和 Agent 基座；请在 Issue 里写清为什么现有契约不够，并补测试与 `docs/play.md`。不要为了玩法去改聊天气泡或网关密钥路径。Agent 用 `createPlayAgent(spec)`，不要直连模型。

## 架构原则

在开发前，请务必阅读并遵守：

### 依赖方向规则

**允许：**
```
server.js (composition root)
    ↓
src/transport
    ↓
src/core
```

**禁止：**
- ❌ `src/core` → `ws`（WebSocket 库）
- ❌ `src/core` → `node:sqlite`
- ❌ `src/core` → `openai`
- ❌ `src/transport` → `src/storage`

### 贡献入口与验收

- 聊天内核、身份/权限、配置组装、嵌入 SDK、治理和发布工程按路线图阶段推进；规划中的接口不按旧 ADR 示例直接调用。
- Play 优先只修改自己的目录。官方狼人杀与基础设施并行，不作为 v1.7 门槛，v2.0 前交付完整参考；社区照同一契约开发更多玩法。
- 身份、授权、审核、事件与 Play 分别定义扩展面。新模块需声明依赖、配置与生命周期，补兼容和失败路径测试；暂不做插件市场。
- 接入改动用普通产品和社区＋玩法两个示例验收；SDK 提供浏览器脚本、npm 分发、类型和原生 JS/React/Vue 最小示例。
- 本文不会因为新增产品方向就授予所有玩法绕过契约修改内核的权限；真实缺口先讨论，再更新实现、测试和契约文档。

### 七大不变量

1. **Ephemeral First** — 默认无数据库、无账号、无 AI 依赖；临时模式是完整产品模式
2. **One Mainline** — 独立/嵌入是交付形态，不拆产品版本或维护两套内核
3. **Optional Means Optional** — 能力按需启用，未开启时不强制外部依赖
4. **Core Before Platform** — 网络、SQL、厂商调用和玩法规则留在适配层
5. **Compatibility Is a Feature** — 应用、配置、协议、数据库及未来 SDK/扩展契约分别演进
6. **Safe by Construction** — 身份、授权、内容治理各司其职；可嵌入不等于可裸露公网
7. **No Premature Generalization** — 以真实宿主接入与官方狼人杀验证边界，不提前建设通用平台

详见 [架构原则](docs/architecture/principles.md)。

### 明确不做的事

以下能力不作为 v2.0 目标：

- 无界面 SDK、任意组件替换、Node 后端库嵌入
- 完整账号系统、宿主动态建频道接口、插件沙箱
- 私聊
- 多租户
- 文件管理（只有图片）
- 语音/视频
- 原生 SDK 和系统推送（WebView 仅探索）
- 玩法商店 / 通用游戏引擎
- 插件市场

此类需求先在 Issue 说明真实场景，不挤占身份、组装、嵌入与治理主线。

## 何时写 ADR

如果你的 PR 涉及以下情况，**必须先写 ADR**（Architecture Decision Record）：

- 引入/移除核心依赖
- 定义公开 API 兼容策略
- 在多个技术方案间做不可逆选择
- 明确产品边界（什么不做）

ADR 模板和示例见 [docs/adr/README.md](docs/adr/README.md)。

## 文档更新

如果你的 PR 涉及以下变更，**必须同步更新文档**：

- 已实现的新配置字段 → 对应可运行示例、配置文档与中英文 README；规划字段只进入设计文档，不提前写入示例
- Protocol 变更 → `docs/architecture/chat-protocol.md`
- 新命令/事件 → Protocol 文档
- 当前架构变更 → `docs/architecture/overview.md` 与相关 ADR；未来边界 → 演进与集成设计
- SDK/扩展接口 → 类型、示例、兼容声明、生命周期与失败路径测试
- 产品阶段变更 → 路线图的“已发布 / 主分支已实现 / 计划中”状态，不改写历史发布记录

## 问题与讨论

- **Bug 报告** → 开 Issue，包含复现步骤
- **功能建议** → 开 Issue，说明使用场景
- **问题咨询** → GitHub Discussions
- **架构讨论** → GitHub Discussions（Architecture 分类）

## 许可证

贡献到 Pavilo 的代码将遵循 [MIT License](LICENSE)。

---

感谢你的贡献！🎉
