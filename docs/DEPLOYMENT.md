# 单实例部署

P1 已完成本机真实 Chrome 闭环；本机未安装 Docker，以下 Docker/Compose、Nginx 和生产 HTTPS/WSS 验收**尚未执行**。文件存在和静态检查不替代实际部署。精确运行结果见 [PROGRESS.md](PROGRESS.md)。

## 本地同源运行

在 `web/` 执行 `npm ci`、`npm run build`，再从 `server/` 执行 `go run ./cmd/ghostchat`，打开 `http://127.0.0.1:8080`。默认只绑定 loopback。所有客户端资源与 API/WS 由同一 Go 进程提供。

Web Crypto 需要安全上下文；localhost HTTP/WS 只用于开发。跨设备与公开部署必须使用 HTTPS/WSS。

## 容器与 Compose

Dockerfile 使用官方 Node 24 构建前端、Go 1.27.2 构建 CGO 关闭的静态程序，最终 `scratch` 层包含程序、前端资源及相应许可证，使用 UID/GID 65532。构建专用 `.dockerignore` 采用允许列表，避免上传 `.git`、`.env`、本机工具、聊天截图或依赖缓存。

Compose 强制只读根文件系统、移除 capabilities、禁止提权、限制内存/CPU/PID、禁用容器日志和 core dump，无任何持久化卷；只把 8080 发布到宿主 `127.0.0.1`。运行层没有 shell/curl，不使用依赖这些工具的容器内 healthcheck；从宿主或监控侧访问 `/healthz`。

在项目目录执行，`PUBLIC_ORIGIN` 必须是实际使用的精确 HTTPS Origin（无末尾斜杠/路径）：

```powershell
$env:PUBLIC_ORIGIN = 'https://chat.example'
docker compose -f deploy/compose.yaml config
docker compose -f deploy/compose.yaml up --build -d
Invoke-RestMethod http://127.0.0.1:8080/healthz
```

Linux 等效命令：

```bash
export PUBLIC_ORIGIN=https://chat.example
docker compose -f deploy/compose.yaml config
docker compose -f deploy/compose.yaml up --build -d
curl --fail http://127.0.0.1:8080/healthz
```

这些命令不会自动配置域名、证书、Nginx 或公网端口。域名和证书需要由部署者配置，然后按下一节接入 HTTPS。

不需要容器时可在 Linux `server/` 使用 `CGO_ENABLED=0 go build -trimpath -o ../ghost-chat-server ./cmd/ghostchat`，以非 root 用户、只读部署目录和独立进程管理器运行；设置绝对 `WEB_DIST_DIR`，禁用 core dump。

## HTTPS 反代

`deploy/nginx.example.conf` 放在 Nginx 的 `http` 配置上下文中。替换 `chat.example` 和证书路径，确认 80/443 入口与 DNS，先执行 `nginx -t` 再 reload。应用上游保持宿主 loopback，不把明文 8080 暴露公网。

示例显式转发 WebSocket Upgrade 与 Origin、不缓存、不缓冲、限制请求大小并关闭该站点访问/错误日志；TLS 站点设置 HSTS。安全头/CSP 由 Go 统一设置。反代超时 65 秒，配合默认 15 秒 heartbeat / 5 秒 pong 超时；修改心跳配置时同步检查代理超时。

服务器不信任 `X-Forwarded-For` 或类似头，示例主动清理这些头。反代下所有用户共享同一连接地址的创建/升级预算；默认 30 次创建/分钟及 120 次升级/分钟是该反代地址的总预算。需要更大容量时配置对应环境变量并做负载测试，不能仅按房间上限推断实际承载量。

## 环境配置

Go 读取进程环境，不自动加载 `.env`。开发示例见根目录 `.env.example`，Compose 仅使用明确列出的无会话秘密配置。

| 变量 | 默认值/含义 |
| --- | --- |
| `ADDR` | `127.0.0.1:8080`；容器内为 `0.0.0.0:8080` |
| `WEB_DIST_DIR` | `../web/dist`，相对进程目录；镜像为 `/app/web` |
| `ALLOWED_ORIGINS` | loopback 5173/8080 开发来源；公开部署必须显式设置 HTTPS 精确来源 |
| `ROOM_TTL` / `WAITING_TTL` | `30m` / `10m`，均从创建起计算 |
| `AUTH_TIMEOUT` / `WRITE_TIMEOUT` | `5s` / `5s` |
| `HEARTBEAT_INTERVAL` / `HEARTBEAT_TIMEOUT` | `15s` / `5s` |
| `MAX_ROOMS` / `MAX_CONNECTIONS` | `1000` / `2100`，容量上限而非负载保证 |
| `CREATE_RATE_PER_MINUTE` / `UPGRADE_RATE_PER_MINUTE` | `30` / `120`，短期内存地址计数 |
| `MESSAGE_RATE_PER_SECOND` | `20`，单连接上限 |

不能将 roomSecret、令牌、完整邀请链接或聊天正文放进环境、部署配置或终端命令。

## 日志、权限与重启

只有单 Go 实例与内存状态，无数据库或恢复。停止、崩溃、更新与重启都使现有房间失效；不支持多实例负载均衡、跨节点路由或无损滚动更新。

应用/反代/容器日志策略不替代宿主、Docker 守护进程、CDN、云平台及诊断审查。禁止原始 header/frame、URI、会话对象、堆快照和公开 pprof。交换区和基础设施副本无法由应用可靠擦除。

## 补测清单

在具备 Docker/Nginx 的 Linux 环境执行以下检查，并把实际输出摘要、镜像 ID、时间和失败项记录到开发记录：

1. `docker compose ... config`、构建、启动及宿主 healthcheck。
2. 使用正式 HTTPS Origin 双浏览器互聊；检查 WSS、证书、安全头和无第三方请求。
3. 错误 Origin/token、第三人、过大帧、速率/容量和慢客户端被拒且正常房间不受未鉴权者销毁。
4. `docker compose ... restart` 后旧链接/历史失效。
5. `docker inspect` 确认 UID 65532、只读、capabilities、端口、资源和无数据卷；检查日志策略以及宿主/代理日志。
6. 完成 [SECURITY.md](../SECURITY.md) 的目标环境手工清单；运行 Linux race、故障/负载与依赖审计。

镜像 Node 主版本标签会随官方修订更新，应用依赖由 lockfile 固定；尚未做镜像摘要锁定或可复现构建验证，不能宣称这些特性。

参考：[Node 官方镜像](https://hub.docker.com/_/node)、[Go 官方镜像](https://hub.docker.com/_/golang)、[Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)、[Nginx WebSocket 反代](https://nginx.org/en/docs/http/websocket.html)。
