# Pavilo 测试策略

> 产品与发布阶段补充（2026-09-24）：最新稳定版是 v1.7.0，一段话接入已发布。v2.0 另需覆盖 SDK 生命周期、第三方 Cookie 禁用、完整狼人杀与迁移回滚。文本规则落地后再补审核竞态。浏览器 CI 从 v1.6.0 起阻塞发布；Node 24/26 仍允许失败。完整门槛见 [路线图](../ROADMAP.md) 和 [版本管理](version-management.md)，不能用旧测试数量代替当次结果。

## 概述

本文档定义 Pavilo 的测试组织、范围和维护策略，确保测试套件保持高质量、可维护且不产生遗留问题。

## 现状分析

### 测试统计

当前以 2026-09-21 文档梳理基线为准（见文末）：`npm test` 为 381 个 Node 测试，379 通过、2 跳过。运行 `npm test` 查看当下实际状态，不要用历史总数代替当次结果。

2026-09-15 快照仅作历史记录：当时约 21 个测试文件、~217 个用例、1 个 skip。分层示意图里的文件/用例数同样是当时估算。

### 测试分层

```
┌─────────────────────────────────────┐
│  E2E (Browser)                      │  1 文件，15 子场景
│  - 完整用户流程验证                  │  慢，真实环境
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Integration (Server)               │  2 文件，29 用例
│  - 完整服务器栈                      │  中速，契约验证
│  - HTTP + WebSocket + Core          │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Component (Channels, Config)       │  4 文件，40 用例
│  - 功能模块端到端                    │  中速，功能保障
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Unit (Client, Core, Transport)     │  14 文件，148 用例
│  - 独立模块逻辑                      │  快，边界情况
│  - 无外部依赖                        │
└─────────────────────────────────────┘
```

## 问题识别

### 🔴 立即处理

1. **当前有 2 个跳过项，不是发布证明**
   - `channels.test.js`：历史同步窗口的 `SYNC_IN_PROGRESS` 集成难以稳定命中；Core 在 `syncing` 时拒绝命令已有单测。继续 skip，不作为 P0。
   - `sqlite/better-sqlite3`：本机未安装可选驱动时跳过该引擎套件；Node 内置 sqlite 路径仍会跑。
   - **决策**: 跳过项随每次发布检查，不因旧版本曾允许而永久豁免。

### 🟡 结构优化

3. **client-state.test.js (31) 和 client-state-regressions.test.js (7) 分离**
   - regressions 文件是为了隔离特定 bug 的回归测试
   - **决策**: 保留分离，regressions 文件仅添加真正的线上 bug 回归用例

4. **协议测试分层**
   - `core.test.js` / `channels.test.js`：v4 行为 + 拒绝非 v4
   - `server.test.js`：wire 契约
   - `client-protocol.test.js`：客户端解析
   - **决策**: 保持分层；v1–v3 兼容测试已在 v0.9.0 删除

## 测试分类与职责

### 1. 单元测试（Unit Tests）

**目标**: 验证单个模块的逻辑正确性，快速反馈

#### 客户端单元测试（`test/client-*.test.js`）
- ✅ `client-state.test.js` - 状态机核心逻辑
- ✅ `client-state-regressions.test.js` - 生产 bug 回归保护
- ✅ `client-connection.test.js` - WebSocket 连接管理
- ✅ `client-messages.test.js` - 消息列表渲染逻辑
- ✅ `client-composer.test.js` - 编辑器状态与草稿
- ✅ `client-mentions.test.js` - @提及解析与匹配
- ✅ `client-images.test.js` - 图片尺寸计算
- ✅ `client-pending.test.js` - 待发送队列
- ✅ `client-protocol.test.js` - 协议解析器

**特点**:
- 不启动服务器
- 不依赖 DOM（UMD 加载测试确保 Node/Browser 兼容）
- 每个模块 < 1 秒执行完成

#### 核心单元测试（`test/core*.test.js`）
- ✅ `core.test.js` - Core 状态机与广播逻辑
- ✅ `core-images.test.js` - 图片头部解析与预算验证

#### 传输单元测试（`test/transport-*.test.js`）
- ✅ `transport-protocol.test.js` - WebSocket 帧解析器
- ✅ `websocket-transport.test.js` - 传输层队列与预算

### 2. 组件测试（Component Tests）

**目标**: 验证功能模块的完整行为

- ✅ `channels.test.js` - 频道隔离、切换、恢复（11 用例，1 跳过）
- ✅ `readonly-channels.test.js` - 只读频道权限验证（5 用例）
- ✅ `config.test.js` - 配置解析、合并、验证（21 用例）
- ✅ `config-example.test.js` - 示例配置有效性（3 用例）

**特点**:
- 可能启动轻量 Core 实例
- 测试功能边界和配置契约
- 每个测试 < 100ms

### 3. 集成测试（Integration Tests）

**目标**: 验证完整服务器栈的端到端行为

- ✅ `server.test.js` - 完整协议握手、消息流、断线恢复（26 用例）
- ✅ `http.test.js` - HTTP 端点、静态资源、安全检查（3 用例）

**特点**:
- 启动完整服务器（HTTP + WebSocket + Core）
- 使用真实网络连接（localhost）
- 每个测试 10-100ms

### 4. E2E 测试（End-to-End Tests）

**目标**: 验证真实用户场景和浏览器集成

- ✅ `browser/chat.test.cjs` - 双标签页完整聊天流程（15 子场景）
  - 登录、发消息、表情、图片、切换频道、断线恢复、优雅停机

**特点**:
- 使用 Playwright 驱动真实 Chrome
- 启动生产模式服务器
- 超时 180 秒
- 通过 `npm run test:browser` 本地执行，也在 CI 的独立 browser-test job 执行

## CI 策略

### 当前 GitHub Actions 工作流

以 [CI](../.github/workflows/ci.yml)、[Release](../.github/workflows/release.yml)、[GHCR](../.github/workflows/ghcr.yml) 为准，以下描述为 2026-09-21 核对结果：

- CI 在 main push 和 PR 时运行 Node 22/24/26 矩阵；Node 22 测试失败阻塞，24/26 的测试步骤允许失败。
- browser-test 是独立 job，不依赖 test job，当前允许失败；它安装 Playwright 并执行浏览器验收。
- Release 在 `v*.*.*` 标签触发，Node 22 的安装、audit、测试失败会阻塞 GitHub Release；v0 或含预发布后缀的版本标为 prerelease。
- GHCR 是独立工作流，目前不等待 Release 测试结果，其稳定标签与预发布行为必须单独检查。

v2.0 目标是支持版本矩阵和关键浏览器验收阻塞所有正式产物发布，并确保预发布不覆盖稳定镜像标签。当前检查不等于该目标已经实现，具体发布步骤见 [版本管理](version-management.md)。

### 本地开发流程

```bash
# 日常开发 - 快速反馈
npm test                    # 228 用例，~0.5 秒

# 提交前检查 - 完整验证
npm run test:browser        # + 浏览器测试，~30 秒

# 调试单个文件
node --test test/channels.test.js
```

## 维护准则

### ✅ 何时添加测试

1. **新功能**: 必须有对应单元测试和组件测试
2. **Bug 修复**: 
   - 如果是客户端 bug → `client-state-regressions.test.js`
   - 如果是服务器 bug → 在相关 test 文件添加回归用例
3. **协议变更**: 更新 `client-protocol.test.js` 和 `server.test.js`
4. **配置字段**: 更新 `config.test.js` 和 `config-example.test.js`

### ❌ 避免测试膨胀

1. **不要重复测试**: 
   - 单元测试已覆盖的逻辑，集成测试不再详细测试
   - 客户端和服务器测试各自负责自己的边界

2. **不要过度 mock**:
   - 优先使用真实依赖（如 Core）
   - 只 mock 外部系统（时间、网络、文件）

3. **不要测试实现细节**:
   - 测试公开 API 和契约，不测试私有函数
   - 重构时测试应该无需修改

### 🔄 何时删除/合并测试

1. **功能废弃**: 同步删除相关测试
2. **协议版本**: v1–v3 兼容测试已在 v0.9.0 删除；保留拒绝路径测试
3. **重复覆盖**: 如果两个测试验证相同边界，保留更清晰的那个

### 🚨 跳过测试的规则

**原则**: 跳过测试（`test.skip`）是技术债务，必须有明确的修复计划

**当前跳过的测试**:
```javascript
// test/channels.test.js
test.skip('a client is told to wait rather than losing events while its history syncs', async (t) => {
  // 问题: 集成层难以稳定命中 SYNC_IN_PROGRESS 窗口
  // 跟踪: 已知限制，不挡 v1.0；契约由 core 单测覆盖
});
```

**流程**:
1. 添加 `test.skip` 时必须注释说明：
   - 问题原因
   - 修复计划
   - 跟踪位置
2. 每个 minor 版本发布前 review 所有跳过测试
3. 超过 2 个版本的跳过测试要么修复要么删除

## 测试质量指标

### 目标

- **通过条件**: 阻塞检查无失败；跳过项说明理由，不把跳过视为通过
- **执行速度**: 
  - 单元测试 < 500ms 总计
  - 集成测试 < 5s 总计
  - E2E 测试 < 60s
- **覆盖率**: 不强制要求数字，但关键路径必须覆盖
- **CI 稳定性**: 主分支 CI 通过率 ≥ 95%

### 本次基线（2026-09-21）

- `npm test`：381 个，379 通过、2 跳过、0 失败。
- 本次为文档更新，未执行浏览器验收，也未重新核实远端 CI 最近运行记录。
- 本文前面的 2026-09-15 统计仅保留为历史快照，不能当作当前发布证明。

## 后续建设

能力开关和宿主身份已随 v1.4.0 发布。治理闭环已随 v1.5.0 发布。嵌入预览已随 v1.6.0 发布。一段话接入已随 v1.7.0 发布。接下来按路线图补提交前文本规则、正式 SDK、完整玩法和升级回归；不再把早期 v0.2/v0.3 重构待办作为当前优先级。

SYNC_IN_PROGRESS 集成窗口仍是有原因的跳过项，核心规则另有测试。新增可注入背压测试条件时再补集成覆盖；跳过项需要随每次发布检查，不因旧版本曾允许而永久豁免。

## 参考资料

- [CONTRIBUTING.md](../CONTRIBUTING.md) - 贡献者测试要求
- [ROADMAP.md](../ROADMAP.md) - 功能路线图
- [docs/architecture/](./architecture/) - 架构决策记录
