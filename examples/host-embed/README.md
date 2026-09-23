# 宿主嵌入示例

最小「已有登录的产品」把 Pavilo 放进 iframe。宿主页面不打开 WebSocket。凭证通过 `postMessage` 送入 `/embed`，不放进地址。

这是网页 iframe 的对照，不是要复制进对方仓库的 SDK。App 的 WebView 用另一条地址，见 [接入说明](../../docs/integrate.md)。不含小程序。消息字段以 [v1.6 设计](../../docs/v1.6-design.md) 为准。

## 准备

1. 复制 sqlite 示例并准备数据目录：

```bash
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data
```

2. 在 `pavilo.yaml` 里按注释打开宿主身份，并加上嵌入来源：

```yaml
embed:
  ancestors:
    - http://127.0.0.1:4174
    - http://localhost:4174
```

3. 不要把这两个源写进 `server.allowedOrigins`。嵌入页自己连接 Pavilo，WebSocket 的 Origin 是 Pavilo，不是宿主。`allowedOrigins` 只给「宿主页面自己开 WebSocket」的 [身份示例](../host-identity/README.md)。
4. 写入 `identity.issuers[0].secret`，或：

```bash
export PAVILO_IDENTITY_SECRET=$(openssl rand -hex 32)
```

5. `npm run config:check` 后 `npm start`
6. 在本目录用同一密钥启动示例：

```bash
PAVILO_IDENTITY_SECRET=... PAVILO_URL=http://127.0.0.1:4173 node server.js
```

7. 打开 http://127.0.0.1:4174 ，用 `ada` / `ada` 登录。页面里应出现 Pavilo，地址栏仍停在 4174。
