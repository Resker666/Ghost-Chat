# 依赖与许可证

应用运行依赖按 lockfile / go.mod 固定；版本升级需要重新验证协议、安全、浏览器与许可证。安装或审计没有发现漏洞不等于未来没有漏洞，也不等于完整安全审查。

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM 19.3.0 | 内存界面与安全文本渲染 | MIT |
| Scheduler 0.28.0 | React DOM 运行时依赖 | MIT |
| lucide-react 1.57.0 | 本地打包界面图标 | ISC，包含部分 Feather 来源图标的 MIT 声明 |
| jsonc-parser 3.3.1 | JSON visitor 检测解码后重复属性，严格禁扩展语法 | MIT，Microsoft |
| qrcode 1.5.4 | 浏览器本地生成邀请二维码，使用 canvas，不调用远程二维码接口 | MIT |
| dijkstrajs 1.0.3 | qrcode 浏览器编码流程的传递依赖 | MIT |
| Vite 8.3.4 注入的 modulepreload helper | 构建产物包含的浏览器运行片段，保留完整 Vite 原始声明 | core MIT；完整 LICENSE.md 另含 bundled 依赖声明 |
| coder/websocket 1.8.15 | Go WebSocket 传输 | ISC |
| Go 标准库 | 服务端运行时与标准 API | Go 分发许可证 |

所有客户端运行依赖本地打包、同源提供，不连接第三方 CDN。二维码库只在显式打开工具时按需加载同源构建 chunk，不将邀请发送到第三方。`jsonc-parser` 只是严格结构校验辅助，不代替密码学或内容渲染边界；二维码编码也不增加加密或身份认证能力。

新增二维码依赖的版本与许可已实读本机安装包；qrcode 的 Node/CLI 其他传递依赖仍记录于 lockfile，不能把整个安装树等同于浏览器实际 bundle。更换打包入口或分发范围时重新核对用途与许可。

## 开发与独立验证依赖

| 依赖 | 范围与用途 | 许可证 |
| --- | --- | --- |
| @types/qrcode 1.5.6 | 仅开发类型声明，不进入浏览器运行代码 | MIT |
| jsqr 1.4.0 | 仅 E2E，独立解码实际 canvas 像素并在内存比较；不进入生产客户端 | Apache-2.0 |

真实邀请与解码文本不得输出到测试错误、日志或截图；断言只报告相等与否。2026-10-15，web/e2e 审计为 0 漏洞；QR 后五项目定向回归已实际完成 25 PASS / 47.8 秒，web 单元测试 86 PASS / 4 files。独立像素解码与生命周期结果见开发记录，不能外推为真机扫码通过。

## 二维码的数据边界

二维码包含完整邀请，包括 roomSecret 和一次性 token，应与邀请链接同等保密。默认隐藏，只由用户显式显示；隐藏、对方就绪、会话结束/过期/导航时清空 canvas，异步绘制需防止旧视图晚到后重绘。浏览器/第三方库内部副本与对方拍照无法保证清除，不提供物理擦除承诺。

使用本地二维码库不代表手机能访问 loopback 邀请；跨设备仍需可达且已验证的 HTTPS origin。独立 jsQR 解码是图像编码正确性证据，真实相机扫码另需实机验收。设计见 [ADR 0006](decisions/0006-local-invitation-qr.md)。

运行分发保留应用 MIT LICENSE 与上述 Go/浏览器依赖的原始许可证；Docker 镜像放在 `/app/licenses`，原生运行包也携带对应文件。Node/Go 构建镜像和完整编译工具不进入最终 runtime，但构建器可能注入运行代码：Vite 的 modulepreload helper 因此随产物保留完整 `Vite/LICENSE.md`，不能泛称所有构建工具代码都不进入 runtime。该原文 core 为 MIT，另包含 Apache-2.0、BSD-2-Clause、CC0-1.0、ISC、MIT 等 bundled 声明，保留原文而非只摘一行许可名。

完整依赖清单以 `web/package-lock.json`、`e2e/package-lock.json` 与 `server/go.mod`/`go.sum` 为准。

Dockerfile 已新增 qrcode/dijkstrajs/Vite 原始许可证 COPY；本轮新镜像构建仍需实际结果，不能沿用旧提交 `5a63896` 的镜像成功。2026-10-15 原生运行包共 17 个文件（含 manifest），上述许可包括 Vite 已随包上传并通过远端 manifest 校验；这是原生包证据，不是新 Docker 镜像通过。若分发测试工具或产物，也应保留 jsqr 的 Apache-2.0 声明。
