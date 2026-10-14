# 依赖与许可证

应用运行依赖按 lockfile / go.mod 固定；版本升级需要重新验证协议、安全、浏览器与许可证。安装或审计没有发现漏洞不等于未来没有漏洞，也不等于完整安全审查。

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM 19.3.0 | 内存界面与安全文本渲染 | MIT |
| Scheduler 0.28.0 | React DOM 运行时依赖 | MIT |
| lucide-react 1.57.0 | 本地打包界面图标 | ISC，包含部分 Feather 来源图标的 MIT 声明 |
| jsonc-parser 3.3.1 | JSON visitor 检测解码后重复属性，严格禁扩展语法 | MIT，Microsoft |
| coder/websocket 1.8.15 | Go WebSocket 传输 | ISC |
| Go 标准库 | 服务端运行时与标准 API | Go 分发许可证 |

客户端不动态加载这些资源，不连接第三方 CDN。`jsonc-parser` 只是严格结构校验辅助，不代替密码学或内容渲染边界。

Docker 运行镜像保留应用 MIT LICENSE，以及上述 Go/浏览器运行依赖的原始许可证到 `/app/licenses`。构建工具依赖与 Node/Go 构建镜像不进入最终 scratch 层；其他形式分发时同样需要保留对应许可证。完整依赖清单以 `web/package-lock.json`、`e2e/package-lock.json` 与 `server/go.mod`/`go.sum` 为准。
