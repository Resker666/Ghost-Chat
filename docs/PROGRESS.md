# 开发与验证记录

日期：2026-10-14。本文件区分已完成工作、实际验证与后续计划，不能将计划写成通过。

## 环境

| 项目 | 实际状态 |
| --- | --- |
| 系统 | Windows / PowerShell |
| Node.js | 24.11.1，已由主代理检查 |
| npm | 11.6.2，已由主代理检查 |
| Go | 便携 Go 1.27.2 已可执行；官方 ZIP 的 SHA-256 与官方校验值一致，系统原始 PATH 未提供 Go |
| Docker | 未安装；容器测试未执行 |
| Playwright / Chrome | 本机已用真实 Chrome 完成 P1 双 context E2E；CI 使用 Playwright Chromium |
| Race 工具链 | 工作区便携 MSYS2 UCRT64 GCC 16.2.0 Rev6 及 19 个依赖包；逐包 SHA-256/大小对官方 HTTPS 仓库数据库核验，本机 `go test -race` 已通过；未更改系统环境 |

## P0

阶段状态：**P0 门槛已完成，P1 已开始**。本节结果冻结为 P0 骨架范围，后续实现不追溯计入本阶段。

已建立 README、MIT LICENSE、安全政策、贡献说明、环境配置说明；docs 中的产品范围、架构、威胁模型、协议、隐私、部署、测试计划和 ADR；Linux Go race/vet、前端检查与 Chromium E2E 的 CI 工作流。HKDF 精确常量、AAD、规范编码、序号、IV/计数约束和固定互通向量已约定。前后端骨架与依赖安装完成。

用户已确认断线销毁整个房间、不重连，以及 MIT。A/B token 一次性，首次鉴权前零人有效，10 分钟双方到齐期限，30 分钟创建起总 TTL。

### 实际测试

以下均由主代理在本机实际执行并反馈；相对路径基于项目目录，Go 命令使用便携 Go 1.27.2。

| 范围 | 实际命令或检查 | 结果 |
| --- | --- | --- |
| 前端依赖 | `web/`: `npm ci` | PASS |
| 前端静态检查 | `web/`: `npm run lint` | PASS |
| 前端构建 | `web/`: `npm run build`，包含 TypeScript `tsc --noEmit` | PASS |
| 前端测试入口 | `web/`: `npm test` | 退出 0，但输出 `No test files found`；**尚无前端业务测试，不计为单元覆盖通过** |
| Go 工具链 | Go 1.27.2 官方 ZIP SHA-256 与官方值比较 | PASS |
| Go 单元测试 | `server/`: `go test ./...` | PASS，2 个 API 测试 |
| Go 静态检查 | `server/`: `go vet ./...` | PASS |
| 服务真实启动 | 编译并实际启动 P0 可执行文件，检查 `/healthz` JSON | PASS |
| 前端真实启动 | Vite 监听本机 15173，实际抓取 HTML | PASS |

独立 `npm run typecheck` 未单列运行；本阶段 `npm run build` 已实际执行同一 TypeScript 检查。P0 没有 E2EE 或双浏览器验收；这些属于 P1，不能由 healthcheck 或构建成功替代。

## P1

阶段状态：**P1 门槛已完成，随后开始 P1.5**。本节记录冻结为 P1 核心功能范围。

已实现 Go 内存房间、独立一次性角色令牌、TTL 与 WebSocket 中继；浏览器 HKDF/AES-GCM、严格 envelope、单调序号与 IV/消息上限；邀请清理、显式加入、双人聊天、断线/销毁/过期清理及响应式 UI。

### 实际测试

以下由主代理与密码模块代理实际执行并反馈；本机 E2E 使用真实 Chrome 和两个独立 contexts。

| 范围 | 命令或检查 | 结果 |
| --- | --- | --- |
| 前端协议/密码单测 | `web/`: `npm test` | PASS，2 files / 69 tests |
| 前端静态检查 | `web/`: `npm run lint` | PASS |
| 前端类型检查 | `web/`: `npm run typecheck` | PASS，密码模块代理另行执行 |
| 前端生产构建 | `web/`: `npm run build`，TypeScript + Vite 8.3.4 | PASS |
| Go 单元与集成 | `server/`: `go test ./...`，包括 httptest 真实 WebSocket | PASS |
| Go 静态检查 | `server/`: `go vet ./...` | PASS |
| Go 依赖固定 | `go mod tidy`，通过 goproxy.cn 下载并使用 sumdb 校验，工作区内 GOPATH | PASS，固定 `github.com/coder/websocket` v1.8.15 |
| 真实浏览器 E2E | `e2e/`: `npm test` | PASS，10 tests / 46.3 秒，正常退出 |

E2E 覆盖：双 context 中文/英文/Emoji/空格互聊与 XSS 文本安全渲染；检查真实浏览器发出的 ciphertext 且不含 roomSecret/明文；Cookie、localStorage、sessionStorage、IndexedDB、CacheStorage、Service Worker 无聊天持久化；错误 token、邀请重用/第三人、错误 secret、重放、篡改；刷新/离线销毁；2,048 字节可发送、2,049 字节拒绝；测试配置 10 秒等待期过期；异步创建取消后可重建；1440×900、390×844、320×568 视口无横向溢出且输入框可见。

首次 E2E 运行有 9 个测试通过，但 Windows `webServer` 子进程退出未完成，需要手动停止本次启动的自有进程。改用 Playwright `globalSetup` 直接 spawn Go 服务并返回停止函数后，10 个测试全部通过且进程正常退出。只将修复后的完整运行计为 P1 E2E 通过。

测试使用虚构内容与测试专用秘密，没有以 mock、文档或构建结果替代真实浏览器验收。上述范围尚不代表 Firefox/WebKit、生产 TLS、Docker 或独立安全审计完成。

## P1.5

状态：**P1.5 核心加固已完成；部署实测待 Linux 环境，整个阶段不标为 100% 验收**。安全头、严格协议、连接/资源边界、日志检查、并发、race、漏洞扫描及部署配置已落地并按实际范围验证。本机未安装 Docker，Docker/Compose/Nginx 和生产 TLS 尚未执行；GitHub CI 未远程运行。

### 已落地加固

- 浏览器/Go 严格 JSON 对齐：拒绝解码后的重复字段；非空明文 1..2,048 字节，密文 17..2,064 字节；保留空白与前导 U+FEFF，拒绝孤立 surrogate/非法 UTF-8。
- 新增 Microsoft MIT 许可的 `jsonc-parser` 3.3.1，在 JSON.parse 前验证重复属性、禁注释/尾逗号/嵌套值；本地打包，无远程请求或 unsafe-eval。
- 后端增加严格 CSP、no-referrer、Permissions-Policy、nosniff、DENY、COOP/CORP；TLS 反代由 Nginx 提供 HSTS。静态文件使用 `os.OpenRoot` 限制符号链接逃逸；关闭默认 HTTP 错误日志，WebSocket 握手错误固定化。
- 连接/限速条目有界并自动过期；Server.Close 取消待鉴权连接；增加并发、心跳、速率、关闭/重启和日志测试。
- App 增加同文档 `hashchange` 清理 fragment；重新打开邀请的完整页面加载仍需显式加入。
- 已提供多阶段 Dockerfile、构建上下文允许列表、UID 65532/只读/无数据卷/禁提权 Compose、HTTPS Nginx 示例和目标环境手工清单；**未运行 Docker/Nginx**。
- CI 增加模块校验与 npm audit，E2E 作业独立重建 web/dist；Actions 使用官方仓库已核实的 checkout 7.0.1、setup-go 7.0.0、setup-node 7.1.0。增加未来 Linux 容器构建、Compose 配置与运行 smoke 检查；**GitHub CI 尚未运行**。

### 本轮实际验证

| 检查 | 结果 |
| --- | --- |
| 前端协议/密码 `npm test` | PASS，2 files / 78 tests |
| 前端 typecheck、lint、production build | PASS |
| web 与 e2e 的 npm 依赖审计 | PASS，0 漏洞 |
| 后端 `go test ./...`、`go vet ./...` | PASS；Windows 符号链接逃逸用例因创建权限不足 SKIP，Linux CI 待运行该用例 |
| 加固后真实 Chrome `npm test` | PASS，12 tests / 1.3 分钟；新增 active 30 秒 TTL、严格安全头、CSP 阻止 inline/跨源 fetch、仅固定启动日志白名单检查 |
| 独立进程重启与同文档 fragment 清理 E2E | PASS，2 个选择用例 / 4.8 秒；旧邀请在新进程中被拒，hashchange 后 fragment 清空 |
| 本机 Go race | `go test -race ./...` PASS，exit 0；api 2.811 秒、protocol 1.259 秒、rooms 1.330 秒、security 1.271 秒；cmd 无 tests |
| Go 漏洞扫描 | `go run golang.org/x/vuln/cmd/govulncheck@latest ./...`，解析为 v1.9.0；PASS，`No vulnerabilities found`；CI 固定该工具 v1.9.0 |
| Docker/Compose/Nginx/生产 TLS | 本机缺工具，未执行 |
| GitHub CI | 已配置，未实际运行 |

重启用例首次超时源于测试使用相同路径只改变 hash 的 `goto`，浏览器没有触发完整页面重载，并非已验证的应用重启故障。改为新建 page 打开旧邀请后检查被拒，用例通过；另行补充同文档 hashchange 回归。

Race 首次 cgo 调用失败源于沙箱启动环境同时含大小写重复 `PATH`/`Path`；使用 Node 规范化唯一环境键后成功，没有报告应用数据竞争。此前 LLVM-MinGW GitHub 下载超时，最终使用经官方仓库数据库逐包核验的工作区 GCC；未更改系统环境，未额外宣称独立 PGP 验证。

上述扫描仅针对固定 Go 1.27.2 与当时依赖/漏洞数据库，不是外部安全审计。

### 最终统一验收

主代理实际运行 `pwsh -NoProfile -File scripts/verify.ps1`，**未使用 `-SkipRace` 或 `-SkipE2E`**，脚本退出成功并输出 `Verification passed for all selected checks.`。本次通过 Node spawn 规范化沙箱中重复大小写 PATH 环境键；这是执行环境适配，常规用户可以直接运行 PowerShell 脚本，没有修改系统环境。

| 范围 | 完整脚本实际执行项 | 最终结果 |
| --- | --- | --- |
| web | `npm ci`、`npm run lint`、`npm run format:check`、`npm run typecheck` | PASS |
| web 单元测试 | `npm test` | PASS，2 files / 78 tests |
| web 构建/审计 | `npm run build`、`npm audit --audit-level=high` | PASS，0 漏洞 |
| Go | `go test ./...`、`go vet ./...` | PASS；Windows 符号链接权限用例仍明确 SKIP |
| Go 模块 | `go mod verify` | PASS，`all modules verified` |
| Go race | `go test -race ./...` | PASS，4 个测试包；api 2.796 秒、protocol 1.213 秒、rooms 1.292 秒、security 1.229 秒 |
| e2e | `npm ci`、`npm test` | PASS，14 tests / 59.2 秒，真实 Chrome，测试服务正常退出 |
| e2e 审计 | `npm audit --audit-level=high` | PASS，0 漏洞 |

14 个 E2E 包含上述 P1/P1.5 聊天、错误/篡改/重放、生命周期、隐私、响应式、安全头/CSP，以及独立进程重启和同文档 fragment 清理回归。另行执行的 Go 漏洞扫描通过结果见前表，统一脚本没有额外声称执行该扫描。

文档至此冻结。核心安全加固与本机统一验证完成；下列缺口保留为未验收：Docker 构建/Compose 运行、Nginx 配置实测、生产 HTTPS/WSS、远程 GitHub CI，以及需 Linux 环境补跑的符号链接逃逸测试。不能由本机通过结果推断这些检查也已通过。

## 本机试用

2026-10-14 验收时已构建 CGO 关闭的本机可执行文件并启动同源预览：`http://127.0.0.1:8080`。实际检查 `/healthz`、首页、JS/CSS 资源与 CSP 均通过。这是开发机当时的运行记录；独立克隆后需按 README 自行安装依赖、构建并启动。可用两个独立浏览器窗口或隐私窗口体验双人流程；跨设备使用需另行配置并验证 HTTPS/WSS。

## 首次源码提交整理

2026-10-14：归档原始完整规划与启动说明并逐字节校验，新增 Unreleased 变更说明；修正独立克隆后的文档路径和命令工作目录，明确本机预览为历史验收记录。补充环境文件、截图及产物的 Git 忽略规则，Linux 验证入口同步格式检查。

本次 `npm run format:check`、`bash -n scripts/verify.sh` 与 Git 忽略规则检查通过。业务与协议代码未变，本次没有重跑上文的完整业务测试，不将历史结果记为本次重新执行。初始提交内容与远程推送分开准备，远程推送由用户最终确认。

## 持续限制

尚未经过独立审计；无前向保密、无真实身份认证、无物理擦除和防截图保证；公网服务器可观察 IP 与元数据，恶意 Web 发布者可替换客户端代码。
