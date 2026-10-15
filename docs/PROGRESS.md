# 开发与验证记录

日期：2026-10-14。本文件区分已完成工作、实际验证与后续计划，不能将计划写成通过。

P0/P1/P1.5 本机验收保留为 2026-10-14 历史记录。远程 CI、维护及后来真实目标的结果依次记在后续 2026-10-15 各节；最新部署结果见“正式域名原生部署”。旧记录中的“CI 未运行”“本机未安装 Docker”“等待部署目标”不代表后续远程状态。

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

## 2026-10-15 远程验证与维护

### 已核实的远程证据

主代理核实 [GitHub Verify run 38558565586](https://github.com/Resker666/Ghost-Chat/actions/runs/38558565586) 为 `completed / success`，对应提交 `5a63896eb9638d9cbba8c748028f8c1e8cb980a0`。以下不是本机缺 Docker 的推测，而是该次远程运行的实际结果：

| 作业 | 实际范围 | 结果 |
| --- | --- | --- |
| `web` | 安装、lint、format、typecheck、单测、build、依赖审计 | PASS |
| `go` | Linux race、vet、模块校验、漏洞扫描 | PASS |
| `e2e` | Linux Chromium，原生 Go 服务，双 context 完整 E2E | PASS |
| `container-build` | Docker 镜像构建、Compose config、只读非 root 容器 health/static smoke | PASS |

基础容器运行已经验证，不再把 Docker/CI 整体列为未执行。完整生产镜像会话、Nginx/HTTPS、正式证书和真实设备/不同网络仍需独立证据；该次 CI 的原生 Go E2E 与容器 smoke 不合并冒称容器完整聊天通过。后续提交需匹配自身 CI 结果，不能沿用 `5a63896` 通过来声称新修改已验证。

### 本轮维护产物

本地新增无敏感材料收集字段的 bug/feature 表单及安全政策分流；新增设备支持矩阵、实验版发布清单、维护说明；README 补充独立 clone 入口。模板合入默认分支前，不声称远程创建 Issue 页面已生效。

私密漏洞报告功能已获用户授权启用，由主代理处理平台设置；当前尚未收到成功证据，因此文档保持“未确认启用”，不冒称入口已可用。收到成功读回后再登记日期和准确 URL。

本轮按部署验收 → 移动浏览器体验推进，开源维护并行。当前只记录已创建的文档与既有 CI 事实，未创建 release/tag，未以这些文档声称新的 HTTPS、容器完整聊天或真机测试已经通过。结果由负责代理提供后续补入。

维护文件校验已实际完成：`web/` 下 `npx --no-install prettier --check ../.github/ISSUE_TEMPLATE/*.yml` 通过（包含 YAML 解析）；使用 Prettier Markdown AST 检查 23 份 Markdown 的本地文件链接，零失效路径；`git diff --check` 通过。GitHub 远程表单渲染、私密入口可达性及本轮业务/部署测试尚不计入这些检查。

### 二维码加入前的运行接口与源码基线

新增测试接口已与代码核对：默认 `e2e/npm test` 仅 Chromium，`test:matrix` 包含五项目，测试代码另有 `npm run typecheck`。`E2E_BASE_URL` 仅为无秘密/子路径的 loopback HTTP 或 HTTPS origin；外部模式跳过原生进程重启。短 TTL 只在专用实例通过 `E2E_SHORT_TTLS=1` 声明，容器重启仅由隔离 runner 通过项目/文件校验启用。正式服务不运行短 TTL 或重启用例，不改 TTL/limits。

本轮实际验证对象为基于 `5a63896` 的当时未提交工作区，包含新的兼容性/测试修改，尚未加入本地二维码。下列结果不归属于未修改的 `5a63896`，不覆盖随后新增的二维码，也不表示新 workflow 已远程执行成功。

| 检查 | 最终实际结果 |
| --- | --- |
| `web/npm test` | PASS，82 tests / 3 files |
| web typecheck / lint / build / format | PASS |
| `e2e/npm run typecheck` | PASS |
| `e2e/npm run test:matrix` | 120 总数，115 PASS / 5.7 分钟，5 个预期 SKIP；每项目仅跳过一个隔离容器 restart 用例 |
| 浏览器版本 | Chrome 155.0.8059.41（`chromium` 项目使用现有 Chrome）、Firefox 157、Playwright WebKit 27.2；另含 Pixel 5/Chromium 与 iPhone 13/WebKit 模拟 |
| npm 审计 | PASS，0 漏洞 |
| Node runner 语法/帮助、`bash -n`、`git diff --check` | PASS；这些不计为 Docker/TLS 执行结果 |
| 外部 origin CLI `--list` 校验 | PASS，5 个解析场景：HTTPS 接受，远程 HTTP、credentials、hash、子路径拒绝；未发起网络测试 |
| 视觉检查 | Chrome 桌面 1440×900、移动模拟 390×844、WebKit 移动模拟截图无重叠；不计为真机 |

新 Chromium 回归先实际复现三项失败：安全对话框焦点循环、390×320 可见输入区、合成 IME Enter 的误发送，修复后五项目完整矩阵通过。合成 IME 事件不能替代真实中文输入法验收。旧复制错误清理和短桌面对话框新增案例同样在五项目通过。

WebKit 还复现 early-effect fragment 清理竞态，运行时与驱动侧检查均为未清理；将无状态监听移到 main bootstrap 后回归通过。Firefox 旧布局断言未等待 rAF/后台页更新，调整为 `bringToFront` 和 `expect.poll`，保持同样严格边界后通过；这是测试时序修正，不是放宽容差或回避布局缺陷。

Firefox 在沙箱内创建页面崩溃，普通用户模式完整矩阵通过，不能据此把应用标为 Firefox 不兼容。真实 iOS/Android 输入法、手机、不同网络与正式域名证书仍无验收证据。

容器入口已准备临时测试 CA、独立 HOME/NSS、链与 hostname 验证及不可信证书负向检查，保持 `ignoreHTTPSErrors:false`；本轮 TLS stack 只有静态审查，当前本机仍无 Docker，尚无本轮容器 HTTPS 完整聊天通过结果。部署主机/域名与真实设备信息仍待用户补充。

私密报告功能仍为 disabled，当前管理员身份未接通，没有修改或宣称启用该设置。公开表单继续只引导安全政策，不使用尚不可用的私密新建链接。未创建 release/tag、未将新工作区归为远程已验证版本。

### 外部 loopback 目标验证

主代理使用已运行的 `http://127.0.0.1:8080` 预览，在 `e2e/` 设置 `E2E_BASE_URL=http://127.0.0.1:8080` 后实际运行：

```text
npm test -- --grep 'two isolated contexts' --output ../.tools/external-e2e-results
```

结果：1 PASS / 2.3 秒。外部模式没有启动默认 18080 测试服务，没有重启或停止目标；只执行基本双 context 互聊流程。这是本机 loopback HTTP 验证，不是 HTTPS、容器 TLS、真实手机或跨网络结果。

### 本地邀请二维码与定向回归

移动方向已加入显式显示/隐藏的本地 canvas 邀请二维码，依据 [ADR 0006](decisions/0006-local-invitation-qr.md)。邀请包含 roomSecret 和一次性 token，不调用远程二维码服务，不持久化图片。绘制与清空/晚到异步结果由独立回归验证。

已安装并核对 qrcode 1.5.4 / MIT、浏览器传递依赖 dijkstrajs 1.0.3 / MIT、@types/qrcode 1.5.6 / 开发类型，以及 E2E 独立解码 jsqr 1.4.0 / Apache-2.0。用途、风险与许可见 [DEPENDENCIES.md](DEPENDENCIES.md)。Dockerfile 已新增 qrcode/dijkstrajs 原始许可证 COPY；这是源码静态确认，本轮新镜像尚未构建，不沿用旧镜像 CI 作为新依赖已构建的证明。

主代理反馈本轮 QR 后实际结果如下，仍属于基于 `5a63896` 的未提交工作区：

| 验证 | 实际结果与范围 |
| --- | --- |
| web 单元测试 | PASS，86 tests / 4 files |
| 最终 web lint / format:check | PASS |
| web 与 e2e npm audit | PASS，0 漏洞 |
| 五项目 QR 后定向 E2E | PASS，25 tests / 47.8 秒；`chromium`、`firefox`、`webkit`、`mobile-chromium`、`mobile-webkit` 每项目 4 个 QR 用例 + 1 个双人基本聊天用例 |
| 定向输出 | `.tools/qr-e2e-results`，被 Git 忽略；不提交可见 QR、解码内容或真实会话材料 |

四个 QR 用例覆盖：默认隐藏/显式展示并用独立 jsQR 解码实际 canvas 后仅在内存比较完整邀请、请求保持同源且不含 roomSecret/fragment；隐藏和主动销毁后退休 canvas 宽高归零；对方成功入场后移除并清空 QR；模块延迟加载在销毁后不能重绘旧邀请。既有双人互聊用例在每个项目同时重跑。

上述 115 PASS / 5 SKIP 是 QR 前完整矩阵，新增 25 PASS 是 QR 后定向回归，两者有基本聊天用例重叠，不相加冒称新的完整矩阵通过。独立像素解码与设备模拟不等于真实手机相机扫码或输入法验收。

本轮文档到此冻结：保留最新结果、此前失败与修复证据和运行接口；未创建 release/tag、提交或推送。Linux 容器 TLS 完整会话、正式域名/不同网络、真实手机，以及管理员启用私密漏洞报告仍等待实际目标或操作证据，不能由本机回归或历史 CI 推断完成。

本机 `http://127.0.0.1:8080` 预览健康检查已由主代理再次确认；这是当前开发机可用性记录，不提供跨设备可达性或新远程部署承诺。私密报告管理员操作仍未完成；最新 API 复查因 TLS 认证失败未得到有效状态，不以该失败推断平台设置发生变化，也未操作平台设置。

### 失败诊断隐私与严格 runner 最终验证

二维码后又修正测试失败路径：禁用 Playwright 自动页面快照，敏感 locator/解码断言使用布尔结论，重启用例通过 `openInvite` 导航以免 call log 打印完整邀请。`error-context.md` 可以保留固定诊断/源码，不声称完全禁止错误文件。

实际正向定向命令为：

```text
npm run test:matrix -- --grep 'clipboard rejection|local invitation QR|actual server process restart|two isolated contexts' --output '../.tools/privacy-regression-results'
```

结果 **25 PASS / 42.8 秒**。每项目 5 个用例：基本双人聊天、复制失败后显式显示、结束后清理旧复制错误、QR 像素解码、原生进程重启。五项目仍为 Chromium、Firefox、WebKit 与两个移动模拟。此结果与 QR 后 25 PASS / 47.8 秒及 QR 前完整矩阵分别记录，不能累计或冒称新完整矩阵已重跑。

下列负向/基础设施验证由主代理与后端代理实际执行并反馈，**不加到正向业务通过数，不等于真实 TLS 容器运行**：

| 检查 | 结果与边界 |
| --- | --- |
| 真实 Playwright 故意失败探针 | PASS；确实填入随机测试 marker 后抛出固定 `CONTROLLED_PRIVACY_PROBE_FAILURE`，得到 1 failed / exit 1，再由父进程扫描全部 stdout/stderr 与结果文件 |
| 探针敏感内容检查 | PASS；无该 marker、无 `# Page snapshot`、无 png/zip/webm；允许 `error-context.md` 中的固定错误与源码；不使用早期仅 `expect(false)` 的探针作为最终证据 |
| 真实安全 reporter 集成探针 | PASS；同样执行到 marker 已显示后的固定失败，summary 恰为 `{passed:0,skipped:0,failed:1,conversationPassed:false,containerRestartPassed:false}`，输出与错误文件无 marker/快照/媒体 |
| 容器 runner CLI 门槛 | PASS；11 组非法输入被拒，3 组帮助入口按预期；不允许 `--reporter` 绕过或将仅列用例作为验收成功 |
| reporter 结果与 schema 自测 | PASS；12 组合成事件按预期判定，2 组非法 schema 被拒；没有把合成事件标为真实会话 |
| stdout/stderr 分流与边界 | PASS；两者各 65,537 bytes 的输出被拒；合法 Docker JSON 与 Linux 结果配合 stderr warning 可正确处理，不混入 JSON |
| runner/reporter 语法、格式、差异检查 | PASS；真实 Linux Docker/TLS 栈仍未执行 |

runner 完整验收要求基础会话和隔离容器重启都实际通过；全 skip、过滤关键用例或仅退出 0 不能构成验收。这里只验证了实现契约及负向处理，仍需在实际 Linux 容器目标运行。最终本机文档结果冻结；未执行 release/tag/commit/push，等待部署主机/域名、真实设备和私密报告管理员的实际后续操作。

## 2026-10-15 正式域名原生部署

本节记录后来获得真实部署目标之后的实际操作，前文“等待主机/域名”和冻结内容保留为当时阶段历史。公开记录只使用服务域名与通用技术信息，不写服务器 IP、登录用户、实际服务器目录、SSH 密钥路径或证书私钥。

### 运行包与原生路线

目标采用 Ubuntu 24.04 x86_64，运行开发机交叉编译的 CGO 关闭 Go 程序和 `web/dist`，由 systemd + Nginx 提供单实例服务；没有在目标上进行 Docker 或 Node/Go 现场构建。本次产物来自工作区，旧提交 `5a63896` 的 CI 不证明这份新产物或 workflow 已远程验收。

允许列表运行包共 **17 个总文件（含 manifest）**，包含 Vite 及其他运行依赖原始许可证。archive SHA-256：

```text
078a9b55b272670e78e4d050c52b5c2317dace4872eff594c6c380eab75662a6
```

上传后远端 archive SHA 与逐文件 manifest 均核对通过。传送完整性、原生服务、TLS、浏览器和续期分别验证，不合并推断。

| 检查 | 实际结果 |
| --- | --- |
| unit 与服务状态 | systemd verify PASS，应用 active/running，Nginx active |
| 运行权限 | 非 root；runtime mount `ro,nosuid`；SSH 目录在 namespace 不可见；CapEff 0、NoNewPrivs 1、CORE 0；应用 stdout/stderr 为 null |
| 资源与端口 | MemoryMax 256 MiB、Tasks 上限 128；8080 仅 loopback，未向公网开放 |
| DNS 与 HTTPS | 正式域名 `chat.resker666.cloud` 的公共 DNS 已核实；外部 HTTPS `/healthz` 200，no-store/HSTS |
| HTTP 行为 | 根路径 308 到 HTTPS；ACME 缺失文件 404 且 Location 为 null，challenge 例外实际生效 |
| 正式证书 | Let's Encrypt issuer YE1；本次到期 2027-01-13 14:17:25（UTC+08:00）；TLS 验证未跳过 |
| 续期配置 | `certbot.timer` active/waiting、deploy hook 已安装；配置存在不表示未来自动续期成功 |

### 正式域名浏览器定向验收

设置 `E2E_BASE_URL=https://chat.resker666.cloud`，清空 `E2E_SHORT_TTLS` / `E2E_CONTAINER`，实际运行：

```text
npm run test:matrix -- --grep 'two isolated contexts exchange|production headers block|local invitation QR decodes' --output '../.tools/production-e2e-results'
```

结果 **15 PASS / 1.9 分钟**：Chromium、Firefox、WebKit、mobile-chromium、mobile-webkit 每项目 3 例，覆盖实际 WSS 的双人 Unicode 互聊/销毁/无存储、安全头/CSP、本地 QR 像素独立解码。浏览器证书校验保持默认开启，目标是真实域名原生服务，不是本地 Go 测试实例。

没有运行或修改生产 TTL、重启、限额或负载。移动两项目仍是设备模拟，不计真实 iOS/Android、相机、软键盘或两台不同网络设备通过。此 15 例是另一测试模式，不能与先前源码矩阵简单累加，也不意味着容器 TLS 栈通过。

### 签发与续期的实际限制

首次正式签发因 secondary CAA SERVFAIL 失败，之后两次直连 ACME 读取遇 45 秒超时。最后通过临时受限 SSH CONNECT 通道成功签发正式证书：两端仅 loopback，只允许 Let's Encrypt production/staging 443，非允许目的返回 403；TLS 没有解密或跳过校验，私钥未离开服务器，未设置全局代理。

直接联网执行 `certbot renew --dry-run --run-deploy-hooks` **FAIL**，staging ACME 45 秒 ReadTimeout。以下为主代理后续实际执行并确认的最终结果：

| 检查 | 结果与准确含义 |
| --- | --- |
| 临时受限通道 dry-run | PASS；加 `--no-random-sleep-on-renew`，所有模拟续期成功，deploy hook 实际执行 |
| hook 与 Nginx | `nginx -t` / reload PASS；成功消息经 stderr 导致 Certbot 显示 `error output`，但 exit 0，不是实际 hook 失败 |
| 通道清理 | PASS；本地 helper 进程 0、远端临时端口无监听，无全局代理；私钥仍仅在服务器 |
| 关闭后的普通直连再测 | FAIL；无代理、禁随机等待，仍为 staging ACME 45 秒 ReadTimeout；不能将通道成功归为 timer 直连成功 |
| 独立 ACME 客户端诊断 | Ubuntu 官方 dehydrated 0.7.0-3 隔离 staging 测试也为 curl 28 timeout；未切换正式证书或 Certbot timer，测试包已卸载清理 |
| Nginx 安装配置 | main/site/drop-in 与本地无请求日志配置精确哈希一致，`nginx -t` 与 reload 实际通过；只核对配置，没有读取任何请求日志，也不声称宿主/云平台无日志 |
| 公开示例一致性 | `nginx.example.conf` 与实际站点除域名/注释外静态比较一致，HTTP ACME 例外与普通 308 跳转均保留 |
| 最终服务与证书 | 应用/Nginx active，MainPID 与测试前一致，`certbot.timer` active/waiting；外部 Node HTTPS 200、authorized=true、TLS 1.3、issuer YE1；正式证书仍到 2027-01-13 14:17:25（UTC+08:00） |

正式服务与证书可用，但**长期自动续期可靠性未通过**。系统 timer 没有临时通道；当前优先运维待办是恢复稳定的 ACME 出站连通性，并在实际无代理续期环境重新验证，不能据 active timer、换客户端或临时通道通过写成已解决。

截至收到用户手机反馈之前的归档状态：真实容器 TLS、真实手机/相机/不同网络、私密报告管理员操作与新工作区对应的远程 CI 仍未完成；没有创建 commit、push、tag 或 release。该段保留历史，手机核心流程的最新反馈见下一节。公开文档未写目标 IP、SSH 身份、实际主机目录或密钥路径，私有目标配置仍在忽略目录中。

### 用户实机核心反馈（2026-10-15）

用户明确反馈 Android 和 iPhone 均通过“电脑与手机：扫码或复制邀请→加入→互聊→销毁”。据此记录为 **用户反馈实机核心流程 PASS（2026-10-15）**，不再将两平台核心流程列为未测；这不是代理独立观察或新增自动化运行，不计入自动化通过数。

用户没有提供设备型号、OS/浏览器名称与版本或网络类型，也没有指明使用了“扫码”还是“复制邀请”分支。因此不能据此独立确认真实相机扫码、指定 Safari/Chrome 版本、不同网络或其他平台细节。后台/锁屏、网络切换、IME 边界、横竖屏等专项仍未验收。

本次仅同步该项用户反馈，没有重跑测试或修改实现。容器 TLS、自动续期出站连通性、私密报告管理员操作和新工作区远程 CI 的既有状态保持不变，文档再次冻结。

## 2026-10-15 推送后 CI

用户授权后，主代理已推送 `8ca689c`。其 [Verify run 38703088198](https://github.com/Resker666/Ghost-Chat/actions/runs/38703088198) 已完成：Go、web 与五项目 E2E 共 7 个作业成功；`container-build` 的镜像构建、Compose 配置、只读非 root health/static smoke 前置步骤成功，随后在 TLS readiness 失败，仅报告 `Verified HTTPS application readiness failed`。尚无足够诊断确定原因，不能标记完整容器 TLS 验收通过；此隔离 CI 结果也不代替线上原生服务状态。

主代理随后推送单文件安全诊断提交 `cbcee956d7d6a77e5123390c0cbf4b2da2082169`。其 [Verify run 38705343238](https://github.com/Resker666/Ghost-Chat/actions/runs/38705343238) 第二轮已确认失败：[容器作业诊断](https://github.com/Resker666/Ghost-Chat/actions/runs/38705343238/job/116323258991) 显示 health `request_error` / `ECONNREFUSED`，HTTP status 为 null、TLS 为 false、protocol 为 null；应用与 Nginx 容器均 running、exit 0。连接尚未进入 TLS 握手，不将它写成已证实的证书或握手错误。

[Moby 社区一手复现讨论](https://github.com/moby/moby/discussions/53256) 报告了仅连接 internal bridge 的容器可能接受发布配置却没有实际 host-port 映射的现象；这是本次排查参考，不替代实际 CI 的根因与修复验证。当前正调整隔离实验拓扑：应用只连接 internal relay、无发布端口；代理连接 relay 与独立普通 ingress bridge，仅向 host loopback 发布。并将核对实际 `NetworkSettings.Ports` 及网络拓扑/内部属性，不能只看 `HostConfig.PortBindings` 中的请求配置。

该修复正在实现，尚待新的 CI 实际结果，**未标为解决或容器 TLS 通过**。其余本机、正式域名、手机反馈与续期限制保留原有历史记录。

## 持续限制

尚未经过独立审计；无前向保密、无真实身份认证、无物理擦除和防截图保证；公网服务器可观察 IP 与元数据，恶意 Web 发布者可替换客户端代码。
