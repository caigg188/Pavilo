# 反向代理部署指南

本文档说明如何在反向代理后部署 Pavilo，支持 HTTPS 和 WebSocket。

## 核心要求

Pavilo 使用 WebSocket 进行实时通信，反向代理必须正确处理：

1. **WebSocket 升级** - 正确转发 `Upgrade` 和 `Connection` 头
2. **Origin 验证** - 配置 `allowedOrigins` 以允许外部域名
3. **超时设置** - WebSocket 长连接需要足够的超时时间

---

## Nginx

### 最小配置

```nginx
upstream pavilo {
    server localhost:4173;
}

server {
    listen 80;
    server_name chat.example.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.example.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket and proxy settings
    location / {
        proxy_pass http://pavilo;
        proxy_http_version 1.1;
        
        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for WebSocket
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        
        # Buffering
        proxy_buffering off;
    }
}
```

### Pavilo 配置

独立打开 `https://chat.example.com` 时，浏览器的 WebSocket 与页面同源，不必把这个源写进 `server.allowedOrigins`。

把页面嵌进另一个网站时，不要靠这张名单。名单管的是「谁自己来连 WebSocket」。嵌入页自己连 Pavilo，Origin 是 `https://chat.example.com`。要写的是 `embed.ancestors`，值是**网站**的源，例如 `https://app.example.com`。网站的内容安全策略还得允许把这个源放进 iframe。

Pavilo 必须单独占一个浏览器能打开的源。不要挂到 `https://app.example.com/pavilo/` 这种子路径下，页面、脚本和 WebSocket 都从站点根路径加载。网站是 HTTPS 时，iframe 的地址也必须是 HTTPS。对照 [examples/alongside](../../examples/alongside/)。

### 测试

```bash
# 测试 HTTP
curl -I http://chat.example.com

# 测试 HTTPS
curl -I https://chat.example.com

# 测试 WebSocket（需要 wscat）
npm install -g wscat
wscat -c wss://chat.example.com
```

---

## Caddy

Caddy 自动处理 HTTPS 和 WebSocket，配置更简洁。

### 最小配置

```caddyfile
chat.example.com {
    reverse_proxy localhost:4173
}
```

就这么简单！Caddy 会自动：
- 申请和续期 Let's Encrypt 证书
- 处理 HTTP → HTTPS 重定向
- 正确转发 WebSocket 连接

### Pavilo 配置

与 Nginx 相同：同源访问不用写 `allowedOrigins`。嵌进别的网站时写 `embed.ancestors`，不要把 Pavilo 挂到网站的子路径下。

### 测试

```bash
# Caddy 自动处理 HTTPS
curl -I https://chat.example.com
```

---

## 通用原则

无论使用哪种反向代理，请确保：

### 1. WebSocket 支持

必须正确转发这些头：
- `Upgrade: websocket`
- `Connection: Upgrade`

### 2. 超时配置

WebSocket 是长连接，建议：
- **读超时**: 86400s (24小时) 或更长
- **写超时**: 86400s (24小时) 或更长
- **保持活动**: Pavilo 每 30 秒发送心跳，75 秒超时

### 3. Origin 与嵌入

`server.allowedOrigins` 只用于别的页面自己打开 WebSocket。Pavilo 自己的页面连自己，不需要把自己的源写进去。

嵌入用 `embed.ancestors`，填网站的源。生产环境若要拒绝没有 Origin 的连接，把 `allowNoOrigin` 设为 `false`。这不能代替嵌入名单，也不能让 HTTPS 网站去嵌一个 HTTP 地址。

### 4. IP 传递

如果需要正确记录客户端 IP：

**Nginx**:
```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

**Caddy**:
```caddyfile
# Caddy 自动设置 X-Forwarded-For
reverse_proxy localhost:4173
```

**Pavilo**:
```yaml
server:
  # 显示成员 IP（仅内网环境推荐）
  exposeMemberIps: true  # 默认值
  
  # 隐藏成员 IP（公网环境推荐）
  # exposeMemberIps: false
```

当前版本**不信任** `X-Forwarded-For` / `X-Real-IP`。值班台人员页和 IP 黑名单看到的是 socket 对端，反向代理后通常是代理自己的地址。拉黑该地址会挡住所有走同一出口的人。可信代理配置不在本期值班台里改。

### 5. 缓冲

WebSocket 不应该被缓冲：

**Nginx**: `proxy_buffering off;`  
**Caddy**: 自动处理

---

## Docker + 反向代理

如果 Pavilo 和反向代理都在 Docker 中：

### docker-compose.yml

```yaml
version: '3.8'

services:
  pavilo:
    build: .
    container_name: pavilo
    # 不暴露到主机，只在内网访问
    expose:
      - "4173"
    volumes:
      - ./pavilo.yaml:/config/pavilo.yaml:ro
    environment:
      PAVILO_CONFIG: /config/pavilo.yaml
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - pavilo
    restart: unless-stopped
```

### Nginx 配置

```nginx
upstream pavilo {
    # 使用 Docker 内网域名
    server pavilo:4173;
}
```

---

## 故障排查

### WebSocket 连接失败

**症状**: 浏览器控制台显示 WebSocket 错误

**检查**:
1. 反向代理是否转发了 `Upgrade` 和 `Connection` 头
2. `allowedOrigins` 是否包含外部域名
3. 浏览器开发者工具 → Network → WS 查看握手详情

### Origin 验证失败

**症状**: 连接被拒绝，日志显示 Origin 错误

**解决**:
```yaml
server:
  allowedOrigins:
    - https://chat.example.com  # 注意：不含路径，只到域名
```

### 连接频繁断开

**原因**: 反向代理超时太短

**解决**:
- Nginx: 增加 `proxy_read_timeout` 和 `proxy_send_timeout`
- Caddy: 通常不需要调整

### 客户端 IP 错误

**症状**: 所有用户显示为同一 IP

**解决**:
1. 反向代理正确设置 `X-Forwarded-For`
2. Pavilo 配置 `maxConnectionsPerIp` 时考虑反向代理场景

---

## 生产环境清单

在生产环境部署前，确认：

- [ ] 已配置 HTTPS（推荐使用 Let's Encrypt）
- [ ] WebSocket 升级正常工作
- [ ] `allowedOrigins` 正确配置
- [ ] `allowNoOrigin` 设为 `false`（公网环境）
- [ ] 反向代理超时设置充足（≥ 86400s）
- [ ] 防火墙允许 80/443 端口
- [ ] SSL 证书自动续期配置
- [ ] 监控和日志收集

---

## 参考链接

- [Nginx WebSocket 文档](https://nginx.org/en/docs/http/websocket.html)
- [Caddy 反向代理文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Pavilo 配置参考](../configuration.md)
