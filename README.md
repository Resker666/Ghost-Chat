# Ghost Chat

无需账号、仅支持双人在线文字聊天的实验性端到端加密 Web 原型。浏览器本地加密，Go 服务仅在内存中管理房间和中继密文，不提供历史消息。

P0/P1 MVP 与核心加固已完成。`fa3e721` 的 [CI 8 作业全部通过](https://github.com/Resker666/Ghost-Chat/actions/runs/38706441313)，覆盖 Go、web、五项目 E2E，以及 Linux 生产镜像经 Nginx 和临时测试 CA 的 HTTPS/WSS 会话与重启。

本机回归、诊断隐私探针及历次 CI 的证据见 [开发记录](docs/PROGRESS.md)。项目尚未经过独立安全审计。

实验服务：[chat.resker666.cloud](https://chat.resker666.cloud)。实际采用 Ubuntu 原生 Go + systemd + Nginx，正式 HTTPS/WSS 已完成五项目的聊天、安全头和本地 QR 定向验证（15 passed）。2026-10-15 用户反馈 Android 与 iPhone 的电脑↔手机核心流程“扫码或复制邀请→加入→互聊→销毁”均 PASS；这是用户实机反馈，不是代理独立观测，系统/浏览器版本、网络类型与实际扫码或复制分支未提供，专项仍待验收。

当前证书与服务正常，但直连续期 dry-run 仍超时，长期自动续期可靠性未通过，应优先解决 ACME 出站连通性。临时通道下的配置/hook 验证已完成且通道已撤除，不能代替直连续期；真实手机专项和私密报告管理员操作继续单独记录，详情见部署记录。

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

```powershell
git clone https://github.com/Resker666/Ghost-Chat.git
cd Ghost-Chat
```

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

等待页可显式显示/隐藏本地邀请二维码。二维码包含完整入场凭证与加密秘密，不上传第三方；不要保存或公开截图。`localhost`/`127.0.0.1` 邀请不能让另一台手机访问，真实跨设备扫码需要可达且可信的 HTTPS 服务。

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
npm run typecheck
npx playwright install chromium
npm test
```

`npm test` 默认只跑 `chromium` 项目。先运行前端 build；未设置 `E2E_BASE_URL` 时，E2E 自动编译并启动 Go 服务，在 `127.0.0.1:18080` 提供 `web/dist`，测试完成后停止自有服务。端口被占用时测试报错，不会复用或停止其他进程。若使用现有 Chrome，可省略 Chromium 下载，并在运行测试前设置 `$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'`；该变量只影响 Chromium 项目。Go 未在 PATH 时，原生测试入口也支持 `GO_BINARY` 指定其可执行文件。

五项目矩阵包括 Chromium、Firefox、WebKit、模拟 Pixel 的 Chromium 和模拟 iPhone 的 WebKit；模拟配置不是真实手机测试。以下从仓库根目录开始，先确保前端已 build：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.tools/browsers'
cd e2e
npm ci
npm run typecheck
npx playwright install chromium firefox webkit
npm run test:matrix
```

`PLAYWRIGHT_BROWSERS_PATH` 应在安装与运行时保持一致，上例将浏览器放入 Git 忽略的 `.tools/browsers`。Linux 缺系统依赖时使用 `npx playwright install --with-deps chromium firefox webkit`。矩阵运行结果、环境限制与真机状态分别记录，不能仅因配置存在就称已支持。

外部测试 origin、隔离容器 HTTPS/WSS 入口及允许的执行范围见 [部署测试接口](docs/DEPLOYMENT.md#测试入口与目标范围)。不要把邀请链接作为 `E2E_BASE_URL`，也不要对正式服务运行短 TTL 或重启测试。

从项目目录一键验证：

```powershell
./scripts/verify.ps1
```

Windows 完整检查中的 race 需要可用的兼容 C 编译器、`CGO_ENABLED=1` 和 `CC`。环境暂缺时可明确选择 `./scripts/verify.ps1 -SkipRace`，记录跳过，不能称完整通过；`-SkipE2E` 同理。Linux 使用 `bash scripts/verify.sh`，必要时先在 `e2e/` 运行 `npx playwright install --with-deps chromium` 安装浏览器系统依赖。

CI 在 Linux 执行 Go race/vet/模块校验/漏洞扫描、前端检查/格式检查/依赖审计、五项目 E2E、容器基础检查及生产镜像 HTTPS/WSS 会话/重启验收。当前验证基准为 `fa3e721`。范围见 [测试计划](docs/TEST_PLAN.md)，浏览器和真机状态见 [设备支持矩阵](docs/DEVICE_SUPPORT.md)。

## 目录

| 目录 | 责任 |
| --- | --- |
| `web/` | React、TypeScript、浏览器加密与内存会话 |
| `server/` | Go 内存房间、一次性鉴权、WebSocket 密文中继 |
| `docs/` | 架构、协议、威胁模型、ADR、验证记录 |
| `e2e/` | 真实 Chromium 双 context 自动化测试 |
| `deploy/` | 单实例容器与 HTTPS 反代示例；实际目标可使用原生 systemd 部署 |
| `scripts/` | 与实际环境匹配的验证入口 |

## 自托管与贡献

部署仅支持单实例、内存状态；服务进程重启使所有房间失效。当前实验目标使用本地交叉编译的 CGO 关闭程序与前端静态产物，由 systemd/Nginx 运行，目标机无需 Node、Go 编译器或 Docker。容器是独立选项，现已由 `fa3e721` 的 Linux CI 验证生产镜像 + Nginx 测试 CA 的完整会话和重启；这不替代正式域名、真机与续期的独立记录。配置与实际证据见 [部署说明](docs/DEPLOYMENT.md)，贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

采用 [MIT 许可证](LICENSE)。许可证和自动化测试都不等于安全审计。

首次交付范围见 [CHANGELOG.md](CHANGELOG.md)，原始项目规划见 [规划归档](docs/planning/README.md)。当前实现与原文冲突时，以 [PRD](docs/PRD.md)、[协议](docs/PROTOCOL.md)、[威胁模型](docs/THREAT_MODEL.md) 和已确认的 [ADR](docs/decisions/) 为准。

非安全问题使用仓库的公开 bug/feature 表单，只提交无敏感数据的步骤与现象；疑似安全问题先查看 [SECURITY.md](SECURITY.md)。维护与实验版发布流程见 [维护说明](docs/MAINTENANCE.md) 和 [发布清单](docs/RELEASE_CHECKLIST.md)。
