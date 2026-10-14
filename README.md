# Ghost Chat

无需账号、仅支持双人在线文字聊天的实验性端到端加密 Web 原型。浏览器本地加密，Go 服务仅在内存中管理房间和中继密文，不提供历史消息。

P0/P1 可运行聊天与 P1.5 核心安全加固已完成，协议/密码单元测试、真实 Chrome E2E、本机 Go race 与漏洞扫描已通过。Docker 和生产 TLS 部署实测待 Linux 环境；完整命令、覆盖范围和当前结果见 [开发记录](docs/PROGRESS.md)。项目尚未经过独立安全审计。

## 安全边界

- 服务器正常实现下不接触聊天明文或 `roomSecret`；公网服务器仍能看到 IP、时序、方向与消息长度。
- 邀请链接包含入场凭证与加密秘密。通过可信渠道分享，得到完整链接的人可能冒充对方。
- 任一参与者结束或断线即销毁整个房间，不支持重连；刷新后无法恢复聊天。
- 清理属于应用层删除。JavaScript 内存、系统交换区、崩溃转储及对方截图不受可靠擦除保证。
- 网页发布者能替换 JavaScript，浏览器扩展和被攻破的终端也能读取明文。
- 首版没有前向保密、长期身份认证或 Tor 匿名性，不适用于高风险保密场景。

完整边界见 [威胁模型](docs/THREAT_MODEL.md)、[隐私说明](docs/PRIVACY.md) 与 [安全政策](SECURITY.md)。

## 本地开发

需要 Node.js 24、npm 11 和 Go 1.27.2（见 `server/go.mod`）。自动化端到端测试还需要 Playwright Chromium；可通过 `CHROME_PATH` 选择已安装的 Chrome。

以下各代码块均从仓库根目录开始执行，除非块内另行切换目录。仓库根目录包含 `web/`、`server/` 和 `e2e/`；依赖、构建产物及本机工具不随源码分发。

在项目目录中使用两个终端：

```powershell
# 终端 1：Go 内存中继
cd server
go run ./cmd/ghostchat

# 终端 2：Vite 客户端
cd web
npm ci
npm run dev -- --host 127.0.0.1
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，创建房间并把邀请链接在第二个浏览器 context 中打开。B 明确点击加入；双方在线后可以互聊。任一方刷新或离线都会结束整个会话。

构建后也可仅启动 Go，同源提供前端和中继：

```powershell
cd web
npm ci
npm run build
cd ../server
go run ./cmd/ghostchat
```

此时打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)。Go 默认从当前 `server/` 工作目录的 `../web/dist` 读取构建产物。端口被占用时，设置 `ADDR`，同时将实际浏览器 Origin 加入 `ALLOWED_ORIGINS`；Vite 默认 API 代理指向 8080。

本地 HTTP/WS 只用于 loopback 开发。浏览器 Web Crypto 需要安全上下文；其他设备访问和公开部署应使用 HTTPS/WSS，同源提供静态资源并配置明确的 Origin allowlist。

禁止把实际会话链接或令牌放入环境变量、终端历史、截图或 Issue。配置仅包含服务监听地址、Origin、TTL 和容量限制。

## 验证

```powershell
cd web
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build

cd ../server
go test ./...
go test -race ./...
go vet ./...
go mod verify
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

双浏览器 context 的 Playwright 测试：

```powershell
cd e2e
npm ci
npx playwright install chromium
npm test
```

先运行前端 build；E2E 自动编译并启动 Go 服务，在 `127.0.0.1:18080` 提供 `web/dist`，测试完成后停止自有服务。端口被占用时测试报错，不会复用或停止其他进程。若使用现有 Chrome，可省略浏览器下载，并在运行测试前设置 `$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'`。Go 未在 PATH 时，测试入口也支持 `GO_BINARY` 指定其可执行文件。

从项目目录一键验证：

```powershell
./scripts/verify.ps1
```

Windows 完整检查中的 race 需要可用的兼容 C 编译器、`CGO_ENABLED=1` 和 `CC`。环境暂缺时可明确选择 `./scripts/verify.ps1 -SkipRace`，记录跳过，不能称完整通过；`-SkipE2E` 同理。Linux 使用 `bash scripts/verify.sh`，必要时先在 `e2e/` 运行 `npx playwright install --with-deps chromium` 安装浏览器系统依赖。

CI 在 Linux 执行 Go race/vet/模块校验/漏洞扫描、前端检查/格式检查/依赖审计、真实 Chromium E2E 和容器 smoke；CI 工作流存在不表示远程作业已运行。详见 [测试计划](docs/TEST_PLAN.md)。

## 目录

| 目录 | 责任 |
| --- | --- |
| `web/` | React、TypeScript、浏览器加密与内存会话 |
| `server/` | Go 内存房间、一次性鉴权、WebSocket 密文中继 |
| `docs/` | 架构、协议、威胁模型、ADR、验证记录 |
| `e2e/` | 真实 Chromium 双 context 自动化测试 |
| `deploy/` | P1.5 单实例容器和 HTTPS 反代示例 |
| `scripts/` | 与实际环境匹配的验证入口 |

## 自托管与贡献

部署仅支持单实例、内存状态；服务进程重启使所有房间失效。已提供多阶段 Dockerfile、只读非 root Compose 与 HTTPS Nginx 示例。本机没有 Docker，尚未执行容器构建/运行或生产 TLS 验收。配置及补测命令见 [部署说明](docs/DEPLOYMENT.md)，贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

采用 [MIT 许可证](LICENSE)。许可证和自动化测试都不等于安全审计。

首次交付范围见 [CHANGELOG.md](CHANGELOG.md)，原始项目规划见 [规划归档](docs/planning/README.md)。当前实现与原文冲突时，以 [PRD](docs/PRD.md)、[协议](docs/PROTOCOL.md)、[威胁模型](docs/THREAT_MODEL.md) 和已确认的 [ADR](docs/decisions/) 为准。
