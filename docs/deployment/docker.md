# Docker 部署指南

本文档说明如何使用 Docker 部署 Pavilo。

## 快速开始

### 使用默认配置

最简单的方式：

```bash
# 克隆仓库
git clone https://github.com/caigg188/Pavilo.git
cd Pavilo

# 使用 Docker Compose 启动
docker compose up -d

# 查看日志
docker compose logs -f

# 访问
open http://localhost:4173
```

### 使用自定义配置

```bash
# 复制示例配置（内存，或改用 pavilo.sqlite.example.yaml）
cp pavilo.example.yaml pavilo.yaml

# 编辑配置
nano pavilo.yaml

# 修改 docker-compose.yml，取消注释配置挂载
nano docker-compose.yml
```

取消注释仓库 `docker-compose.yml` 里默认路径的挂载（工作目录是 `/app`）：

```yaml
volumes:
  - ./pavilo.yaml:/app/pavilo.yaml:ro
```

SQLite 还要挂数据目录，并关掉 `read_only`（见下方「数据持久化」）。然后启动：

```bash
docker compose up -d
```

---

## 构建镜像

### 从源码构建

```bash
# 构建镜像
docker build -t pavilo:latest .

# 运行容器
docker run -d \
  --name pavilo \
  -p 4173:4173 \
  pavilo:latest
```

### 多平台构建

```bash
# 为 AMD64 和 ARM64 构建
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t pavilo:latest \
  .
```

---

## 运行选项

### 基本运行

```bash
docker run -d \
  --name pavilo \
  -p 4173:4173 \
  pavilo:latest
```

### 使用自定义端口

通过环境变量：
```bash
docker run -d \
  --name pavilo \
  -p 8080:8080 \
  -e PORT=8080 \
  pavilo:latest
```

### 挂载自定义配置

```bash
docker run -d \
  --name pavilo \
  -p 4173:4173 \
  -v $(pwd)/pavilo.yaml:/config/pavilo.yaml:ro \
  -e PAVILO_CONFIG=/config/pavilo.yaml \
  pavilo:latest
```

### 安全加固运行

```bash
docker run -d \
  --name pavilo \
  -p 4173:4173 \
  --read-only \
  --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  pavilo:latest
```

---

## Docker Compose

### 基础配置

`docker-compose.yml`:
```yaml
version: '3.8'

services:
  pavilo:
    build: .
    container_name: pavilo
    ports:
      - "4173:4173"
    restart: unless-stopped
```

### 带自定义配置

```yaml
version: '3.8'

services:
  pavilo:
    build: .
    container_name: pavilo
    ports:
      - "4173:4173"
    volumes:
      - ./pavilo.yaml:/config/pavilo.yaml:ro
    environment:
      PAVILO_CONFIG: /config/pavilo.yaml
    restart: unless-stopped
```

### 安全加固配置

```yaml
version: '3.8'

services:
  pavilo:
    build: .
    container_name: pavilo
    ports:
      - "4173:4173"
    volumes:
      - ./pavilo.yaml:/config/pavilo.yaml:ro
    environment:
      PAVILO_CONFIG: /config/pavilo.yaml
    restart: unless-stopped
    
    # 安全选项
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp
    
    # 健康检查
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4173/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 3s
      start_period: 5s
      retries: 3
```

---

## 健康检查

Docker 镜像内置健康检查，检查 `/healthz` 端点。

### 查看健康状态

```bash
# 查看容器健康状态
docker ps

# 查看健康检查日志
docker inspect pavilo | jq '.[0].State.Health'
```

### 手动健康检查

```bash
# 在容器内执行
docker exec pavilo curl -f http://localhost:4173/healthz

# 从主机执行
curl http://localhost:4173/healthz
```

响应示例：
```json
{
  "ok": true,
  "users": 3,
  "messages": 42,
  "roomBytes": 8192,
  "clients": 3,
  "ephemeral": true
}
```

---

## 日志管理

### 查看日志

```bash
# 实时查看日志
docker logs -f pavilo

# 查看最近 100 行
docker logs --tail 100 pavilo

# 带时间戳
docker logs -f --timestamps pavilo
```

### 日志驱动

配置日志驱动以防止磁盘占满：

```yaml
services:
  pavilo:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

---

## 数据持久化

默认镜像仍是零编译、纯内存：不挂卷，容器一停记录就没了。

若启用 SQLite，复制留存示例、写入 `operator.token`（或设 `PAVILO_OPERATOR_TOKEN`），并把数据目录挂出来。**必须关掉 `read_only`**，否则数据库无法写入。

```bash
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data
openssl rand -hex 32    # 写入 pavilo.yaml 的 operator.token
docker run -d \
  --name pavilo \
  -p 4173:4173 \
  -v "$PWD/pavilo.yaml:/app/pavilo.yaml:ro" \
  -v "$PWD/data:/app/data" \
  ghcr.io/caigg188/pavilo:latest
```

Compose 等价写法：取消注释 `./pavilo.yaml:/app/pavilo.yaml:ro` 与 `./data:/app/data`，去掉 `read_only: true`。配置落在 `/app/pavilo.yaml` 时不必设 `PAVILO_CONFIG`。若把文件挂到别的路径，必须同时设置 `PAVILO_CONFIG` 指向同一路径。

打开 `http://localhost:4173/admin` 配置模型渠道。sqlite 但没填 token 时聊天仍可用，管理页为 404。

不要让两个 Pavilo 实例共享同一个 db 文件。默认镜像不编译 `better-sqlite3`；Node 22.5+ 走内置 `node:sqlite`。

---

## 网络配置

### 桥接网络（默认）

```bash
docker run -d \
  --name pavilo \
  -p 4173:4173 \
  pavilo:latest
```

### 主机网络

如果需要暴露局域网地址：

```bash
docker run -d \
  --name pavilo \
  --network host \
  pavilo:latest
```

**注意**: 主机网络模式下，`-p` 参数无效，容器直接使用主机的端口。

### 自定义网络

```yaml
version: '3.8'

networks:
  pavilo_net:
    driver: bridge

services:
  pavilo:
    networks:
      - pavilo_net
```

---

## 环境变量

Pavilo 支持以下环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `4173` |
| `PAVILO_CONFIG` | 配置文件路径 | 无（默认读工作目录 `./pavilo.yaml`，没有则用内置默认值） |
| `PAVILO_OPERATOR_TOKEN` | 覆盖 `operator.token`；sqlite 下用于打开 `/admin` | 无 |

示例：
```bash
docker run -d \
  -e PORT=8080 \
  -e PAVILO_CONFIG=/config/pavilo.yaml \
  -v $(pwd)/pavilo.yaml:/config/pavilo.yaml:ro \
  -p 8080:8080 \
  pavilo:latest
```

---

## 故障排查

### 容器无法启动

```bash
# 查看容器日志
docker logs pavilo

# 查看容器详情
docker inspect pavilo
```

常见问题：
- **端口被占用**: 改用其他端口 `-p 8080:4173`
- **配置文件错误**: 检查 YAML 语法
- **权限问题**: 确保配置文件可读

### 健康检查失败

```bash
# 检查容器内网络
docker exec pavilo curl -I http://localhost:4173/healthz

# 检查容器进程
docker exec pavilo ps aux
```

### WebSocket 连接失败

1. 检查防火墙是否允许端口
2. 如果使用反向代理，参考 [反向代理文档](./reverse-proxy.md)
3. 检查浏览器控制台错误信息

### 容器内存占用高

```bash
# 查看资源使用
docker stats pavilo
```

Pavilo 是内存数据库，消息越多占用越大。可以通过配置限制：
```yaml
limits:
  maxMessagesPerChannel: 300  # 每频道最多 300 条消息
  maxChannelBytes: 33554432   # 每频道最多 32MB
```

---

## 更新部署

### 使用 Git

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose down
docker compose build
docker compose up -d
```

### 使用镜像标签

```bash
docker pull ghcr.io/caigg188/pavilo:latest
# 或钉死版本：ghcr.io/caigg188/pavilo:1.7.0
# v1.6.0 只有 iframe 预览，没有 embed.direct，也不认 fragment

# 停止旧容器
docker stop pavilo
docker rm pavilo

# 启动新容器
docker run -d --name pavilo -p 4173:4173 ghcr.io/caigg188/pavilo:latest
```

v1.x 标签会打 `latest`、`{{major}}.{{minor}}` 和主版本 `1`。不要用 v0.x 镜像当生产基线。

---

## 生产部署清单

部署到生产环境前，确认：

- [ ] 使用 `restart: unless-stopped` 或 `restart: always`
- [ ] 配置健康检查
- [ ] 设置日志驱动和大小限制
- [ ] 启用安全选项（read-only, no-new-privileges, cap_drop）
- [ ] 配置反向代理（HTTPS + WebSocket）
- [ ] 配置防火墙规则
- [ ] 监控容器状态和资源使用
- [ ] 备份配置文件；sqlite 时另备份 `data/`（停服后 `npm run storage -- backup`）

---

## 示例：完整的生产配置

```yaml
version: '3.8'

services:
  pavilo:
    build: .
    container_name: pavilo
    
    # 网络
    ports:
      - "127.0.0.1:4173:4173"  # 仅监听本地，由反向代理转发
    
    # 配置
    volumes:
      - ./pavilo.yaml:/config/pavilo.yaml:ro
    environment:
      PAVILO_CONFIG: /config/pavilo.yaml
    
    # 重启策略
    restart: unless-stopped
    
    # 安全
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp
    
    # 资源限制
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    
    # 健康检查
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4173/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 3s
      start_period: 5s
      retries: 3
    
    # 日志
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

---

## 参考链接

- [Dockerfile 最佳实践](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [反向代理部署](./reverse-proxy.md)
- [Pavilo 配置参考](../README.md#配置)
