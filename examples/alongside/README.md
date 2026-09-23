# 在自己的网站旁边跑语亭

这份配置给「自己启动 Pavilo，再把现成页面嵌进自己的网站」。不改聊天页。项目不提供托管服务器。

`embed.ancestors` 写成浏览器打开你的网站时的源。本地对照 [host-embed](../host-embed/) 时是 `http://127.0.0.1:4174` 和 `http://localhost:4174`。不要写成 Pavilo 自己的源，也不要写进 `server.allowedOrigins`。

```bash
mkdir -p data
# 镜像里的进程用户是 uid 1001。数据目录要它能写。
chown 1001:1001 data
export PAVILO_IDENTITY_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

然后用同一把密钥启动宿主页面，见 [host-embed](../host-embed/)。嵌页代码用那里的 `frame.js`，每次 `hello` 重新签发，不要在凭证过期时拆掉 iframe。

网页如果是 HTTPS，这里公布给浏览器的地址也必须是 HTTPS。反向代理见 [反向代理](../../docs/deployment/reverse-proxy.md)。Pavilo 单独占一个源，不要挂在网站的子路径下。
