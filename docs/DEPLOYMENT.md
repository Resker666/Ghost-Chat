# 单实例部署

截至 2026-10-15，提交 `5a63896` 的 [Linux CI](https://github.com/Resker666/Ghost-Chat/actions/runs/38558565586) 已实际完成 Docker 构建、Compose 配置校验，以及只读非 root 容器的 `/healthz` 和首页静态响应检查。2026-10-14 本机未安装 Docker 的记录仍保留为历史事实。

随后实际目标采用 Ubuntu 原生程序 + systemd + Nginx，正式域名 [chat.resker666.cloud](https://chat.resker666.cloud) 已启用可信 HTTPS/WSS，并完成五项目聊天/安全头/本地 QR 定向验证（15 PASS / 1.9 分钟）。2026-10-15 用户另反馈 Android 与 iPhone 的电脑↔手机邀请传递/加入/互聊/销毁核心流程 PASS；不是代理独立观测，版本、网络与扫码或复制分支未提供，专项仍待确认。原生结果不代替 TLS 容器。证书有效，但直接联网续期 dry-run 已因 ACME 读取超时失败，不能把 timer 启用当作自动续期可用；长期出站连通性仍需解决。精确证据见 [PROGRESS.md](PROGRESS.md)，设备范围见 [DEVICE_SUPPORT.md](DEVICE_SUPPORT.md)。

## 本地同源运行

在 `web/` 执行 `npm ci`、`npm run build`，再从 `server/` 执行 `go run ./cmd/ghostchat`，打开 `http://127.0.0.1:8080`。默认只绑定 loopback。所有客户端资源与 API/WS 由同一 Go 进程提供。

Web Crypto 需要安全上下文；localhost HTTP/WS 只用于开发。跨设备与公开部署必须使用 HTTPS/WSS。

## 原生 systemd 路线

当前实验目标选择在开发机构建 `web/dist` 与 CGO 关闭的 Linux amd64 Go 程序，仅传送 runtime 与原始许可证；目标只运行程序、systemd、Nginx 和证书工具，无需部署 Node、Go 编译器或 Docker。

通用交叉编译示例（Bash，从仓库根目录；前端先按 README 构建）：

```bash
cd server
mkdir -p ../.tools/runtime
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o ../.tools/runtime/ghost-chat ./cmd/ghostchat
```

按允许列表打包程序、前端资源、应用和运行依赖许可证，附逐文件 manifest；在传送前后核对 archive SHA-256 和 manifest。运行目录、SSH 用户/密钥、证书私钥和目标配置仅放被忽略的私有部署配置，不复制到公共记录或会话环境变量。上传与校验成功不替代启动、TLS 或浏览器验收。

原生服务配置应设置绝对 `WEB_DIST_DIR`、精确 `ALLOWED_ORIGINS` 和 loopback 监听；由非 root 身份与 systemd 限制运行，运行资源只读，不允许写聊天数据、提高权限、读取 SSH 材料或生成 core dump。更新前核验 unit，按计划管理服务；重启会销毁内存房间，不能提供无损恢复承诺。具体目录与账号由部署者私下配置，不在这里给出当前目标值。

2026-10-15 已实际核实的原生部署事实：

| 项目 | 结果 |
| --- | --- |
| 运行包 | 17 个总文件，含 manifest；Vite 与其他原始许可证在包内，远端 manifest 校验通过 |
| systemd | unit 验证通过，应用 active/running；Nginx active |
| 最小权限 | 非 root，runtime mount `ro,nosuid`；SSH 目录在服务 namespace 不可见；capabilities 0、NoNewPrivs 1、core limit 0；应用 stdout/stderr 为 null |
| 资源与上游 | MemoryMax 256 MiB、Tasks 上限 128；8080 仅监听 loopback，未公开暴露 |
| 正式 HTTPS | `/healthz` 200、no-store/HSTS；HTTP 根 308 到 HTTPS |
| ACME 例外 | HTTP challenge 缺失文件返回 404 且没有 Location，未被整站跳转吞掉 |
| 正式证书 | Let's Encrypt，issuer YE1；本次 notAfter 为 2027-01-13 14:17:25（UTC+08:00），后续续期需更新记录 |
| 浏览器选定检查 | 五项目每组三用例：实际 WSS 聊天/销毁/Unicode/存储检查、安全头/CSP、QR 像素解码；15 PASS / 1.9 分钟，TLS 校验保持开启 |
| 续期 | `certbot.timer` active/waiting；临时受限通道 + no-random-sleep 的 dry-run/hook PASS；关闭通道后的普通直连仍 FAIL，staging ACME 45 秒 ReadTimeout，长期自动续期可靠性未通过 |
| 安装日志配置 | Nginx main/site/drop-in 与本地关闭请求日志的配置哈希一致，`nginx -t` 与 reload 成功；没有读取请求日志，不代表宿主/云平台无日志 |
| 最终外部状态 | HTTPS 200，证书 authorized=true、TLS 1.3；应用/Nginx active，MainPID 与测试前一致；正式证书未切换 |

本次原生部署来自工作区运行产物，不将旧 `5a63896` 的 CI 当作该产物或新 workflow 已远程通过。正式域名只跑选定基础用例，没有改生产 TTL/limits，没有运行生产重启、短 TTL 或负载测试。

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

容器是独立可选路线；当前正式域名使用上一节原生 systemd 运行产物，不能将其验证结果计为 Docker 完整 TLS 会话通过。

## HTTPS 反代

`deploy/nginx.example.conf` 放在 Nginx 的 `http` 配置上下文中。替换 `chat.example` 和证书路径，确认 80/443 入口与 DNS，先执行 `nginx -t` 再 reload。应用上游保持宿主 loopback，不把明文 8080 暴露公网。

示例显式转发 WebSocket Upgrade 与 Origin、不缓存、不缓冲、限制请求大小并关闭该站点访问/错误日志；TLS 站点设置 HSTS。安全头/CSP 由 Go 统一设置。反代超时 65 秒，配合默认 15 秒 heartbeat / 5 秒 pong 超时；修改心跳配置时同步检查代理超时。

当前目标另使用隔离的 Nginx 主配置及该服务的 systemd drop-in，保留 HTTP ACME challenge 路径例外，其余 HTTP 请求跳到 HTTPS。公开 `nginx.example.conf` 已同步 ACME location，308 仅在普通 location 内；配置文件仍不负责自动申请/续期证书。证书私钥留在服务器，定时器、网络可达性和 reload hook 需分别验收。

### 证书与续期结果

本次正式签发先遇 secondary CAA SERVFAIL，后续两次直连 ACME 读取超时。通过一次临时受限 SSH CONNECT 通道完成签发：两端仅 loopback，目的仅允许 Let's Encrypt production/staging 的 443，其余拒绝；未解密 TLS、未跳过证书检查，私钥未离开服务器。

经该通道的 `renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew` 实际 PASS，deploy hook 执行且 Nginx 配置检查/reload 成功。配置检查的成功信息写入 stderr，Certbot 将其显示为 `error output`，但实际 exit 0 且报告所有模拟续期成功；不能仅凭这段显示把成功 hook 误记为失败。

随后已关闭全部临时通道：本地 helper 进程为 0，远端临时端口无监听，无全局代理；外部 HTTPS 仍正常。系统 timer 没有配置该临时通道。关闭通道后普通直连、同样禁随机等待的 dry-run 再次因 45 秒 ReadTimeout 失败；隔离测试 Ubuntu 官方 dehydrated 0.7.0-3（Bash/curl ACME 客户端）也出现 curl 28 超时，测试包随后卸载清理，没有切换正式证书或 Certbot timer。

当前正式证书有效到 2027-01-13 14:17:25（UTC+08:00），但长期自动续期可靠性**未通过**。优先待办是定位并恢复稳定 ACME 出站连通性，再在真实 timer 所用的无临时代理环境重测 dry-run 与 hook；不能把换客户端、临时通道成功或 active timer 当成问题已解决。公开记录不含当前目标的 SSH 用户、主机目录、私钥或代理连接参数。

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

## 测试入口与目标范围

以下代码块各自从仓库根目录开始。先安装对应依赖，原生模式先构建 `web/dist`。`e2e/` 的 `npm test` 默认只跑 Chromium；`npm run test:matrix` 跑配置中的五项目，`npm run typecheck` 检查测试代码。

### 原生与外部 origin

| 配置 | 实际行为与边界 |
| --- | --- |
| 不设 `E2E_BASE_URL` | 自动启动并清理本次创建的原生 Go 服务，使用专用 30 秒总 TTL / 10 秒等待期 |
| `E2E_BASE_URL` | 仅接受无 credentials、子路径、query、fragment 的 HTTPS origin，或 HTTP loopback；不自动启动、停止或重启该外部服务 |
| `E2E_SHORT_TTLS=1` | 仅声明外部目标已由部署者配置为专用短 TTL 测试实例，启用对应断言；不会修改服务端 TTL，不得对正式服务设置 |
| `E2E_CONTAINER=1` | 仅由隔离容器 runner 管理，并结合专用 Compose project/file 验证后运行容器重启；不能用来授权重启任意服务 |
| `PLAYWRIGHT_BROWSERS_PATH` | 浏览器安装与运行使用同一路径，本机可放到被 Git 忽略的 `.tools/browsers` |

HTTP loopback 只包括 `localhost`、`127.0.0.1`、`[::1]`。地址只能是 origin，不能放房间路径、邀请 fragment 或其他秘密。外部模式跳过原生进程重启；不启用短 TTL 时跳过等待/总 TTL 用例。

对已获授权的正式 HTTPS 服务，仅选择基础互聊/安全头用例，不把整套测试、短 TTL 或容器重启指向它，也不改生产 TTL/limits：

```powershell
$env:E2E_BASE_URL = 'https://chat.example'
Remove-Item Env:E2E_SHORT_TTLS -ErrorAction SilentlyContinue
Remove-Item Env:E2E_CONTAINER -ErrorAction SilentlyContinue
cd e2e
npm test -- --grep 'two isolated contexts exchange|production headers block'
```

替换成实际已授权的 origin 后再运行，基础用例会创建并销毁自己的测试房间。测试结束后在同一终端移除 `E2E_BASE_URL`，再运行默认原生入口，避免继承错误目标。完整回归应使用专用隔离实例，不能用这两个选择用例宣称目标的全部生命周期已验收。

### 隔离容器 HTTPS/WSS

入口为 `node scripts/container-e2e.mjs`，使用 `deploy/compose.e2e.yaml`。需要本地 Linux Docker/Compose、OpenSSL 3+、NSS `certutil`、`e2e/` 的 npm 依赖和已安装的 Playwright Chromium；Docker context 必须为本地 Unix socket，runner 拒绝远程 daemon。不要直接把该测试 Compose 当作正式部署。

```bash
cd e2e
npm ci
npx playwright install --with-deps chromium
cd ..
node scripts/container-e2e.mjs
```

runner 默认只跑 Chromium。`CONTAINER_HTTPS_PORT` 默认 18443，仅绑定 loopback；占用时报错，不复用已有服务。测试创建随机专用 Compose 项目、生产应用镜像和非 root Nginx，自动设置外部 origin、短 TTL 和容器重启限制，完成后只清理其自有项目、镜像与临时目录。

隔离实验的网络契约调整为：应用只连接 `internal` relay 且不发布端口；Nginx 同时连接 relay 与独立普通 ingress bridge，仍只向 host loopback 发布。验收需核对实际 `NetworkSettings.Ports`、连接的网络及其 `Internal` 属性，不把仅有 `HostConfig.PortBindings` 请求当作端口已生效。该调整针对推送后 CI 的连接拒绝排查，正在实现并等待新 CI；不表示容器 TLS 已通过，也不改变线上原生服务。

完整 runner 验收要求基础双人会话与隔离容器重启用例均实际执行并通过。只 `--list`、全部 skipped，或用过滤参数排除了任一关键用例，都不构成完成验收；不能仅凭 Playwright 进程退出 0 记成功。runner 使用受控的安全结果 reporter，仅输出无秘密计数和关键测试是否通过，不允许用 `--reporter` 覆盖。普通生产 origin 的两个选择用例仍只是前节定义的受限检查，不能替代完整容器验收。

2026-10-15 已实际完成 CLI 拒绝、合成事件/schema/输出边界自测和真实 Playwright 固定失败 reporter 集成。它们验证验收门槛与安全诊断，不代表本轮 TLS 容器栈已运行；该隔离容器模式的 Linux/测试 CA 目标仍待实际执行并绑定新提交记录。

证书来自 `.tools/container-e2e/` 中的短期测试 CA，浏览器使用临时 HOME/NSS trust database，Node 使用同一测试 CA；链与 hostname 验证保持开启，`ignoreHTTPSErrors:false`，不修改系统全局信任。该入口还检查不可信签发者与错误 hostname 被拒绝。

关闭 trace、视频和截图不能单独证明失败诊断无会话材料；异常上下文、locator 断言和所有 reporter 输出都需用故意失败用例检查。测试不得归档完整邀请、二维码、解码文本、明文或原始网络内容；安全统计与工具基础设施诊断分开处理，不把原始错误正文拼入统计报告。

受控测试 CA 下的 TLS/完整会话范围仍须实际运行并登记结果；入口代码存在不表示已通过。即使该入口通过，也不自动证明正式域名证书、真实手机或跨网络验收。runner 会转交 Playwright 参数，但当前信任准备针对 Chromium；其他引擎需要各自信任配置与实测，不得通过忽略 TLS 错误来冒称支持。

## 日志、权限与重启

只有单 Go 实例与内存状态，无数据库或恢复。停止、崩溃、更新与重启都使现有房间失效；不支持多实例负载均衡、跨节点路由或无损滚动更新。

应用/反代/容器日志策略不替代宿主、Docker 守护进程、CDN、云平台及诊断审查。禁止原始 header/frame、URI、会话对象、堆快照和公开 pprof。交换区和基础设施副本无法由应用可靠擦除。

## 各模式后续验收

原生正式域名已完成上述 15 个受限流程、权限/TLS/安装日志配置核对；Android/iPhone 核心流程已获用户实机 PASS 反馈，具体版本、网络、相机与后台/输入等专项继续单独验证。优先修复续期出站连通性，不对正式服务追加短 TTL、重启或负载操作。

基础 Docker/Compose/health/static 检查已在历史 CI 通过。下面继续面向容器完整流程，不将当前原生结果记为容器通过，也不要求当前原生目标安装 Docker。代码、镜像或配置改变时验证相应项，记录产物、测试模式、日期和结果，不归档真实会话材料：

1. `docker compose ... config`、构建、启动及宿主 healthcheck。
2. 使用正式 HTTPS Origin 双浏览器互聊；检查 WSS、证书、安全头和无第三方请求。
3. 错误 Origin/token、第三人、过大帧、速率/容量和慢客户端被拒且正常房间不受未鉴权者销毁。
4. `docker compose ... restart` 后旧链接/历史失效。
5. `docker inspect` 确认 UID 65532、只读、capabilities、端口、资源和无数据卷；检查日志策略以及宿主/代理日志。
6. 完成 [SECURITY.md](../SECURITY.md) 的目标环境手工清单；运行 Linux race、故障/负载与依赖审计。

受控测试 CA 或忽略证书错误的自动化，只能记录为该测试环境的 TLS 覆盖，不能记作正式有效证书、真实设备或不同网络验收。真实设备应使用其实际信任的 HTTPS 服务；记录系统/浏览器版本和清理结果，不能上传邀请链接、明文、原始帧或抓包。

镜像 Node 主版本标签会随官方修订更新，应用依赖由 lockfile 固定；尚未做镜像摘要锁定或可复现构建验证，不能宣称这些特性。

参考：[Node 官方镜像](https://hub.docker.com/_/node)、[Go 官方镜像](https://hub.docker.com/_/golang)、[Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)、[Nginx WebSocket 反代](https://nginx.org/en/docs/http/websocket.html)。
