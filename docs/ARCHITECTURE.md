# 架构

## 组件与信任边界

```text
Browser A: roomSecret, A/B direction keys, displayed messages
    | same-origin HTTP API / WebSocket ciphertext and control frames
Go relay: hashed role tokens, room state, bounded outbound queues
    | WebSocket ciphertext and control frames
Browser B: roomSecret, A/B direction keys, displayed messages
```

客户端从 Web 发布者获取代码，必须信任所执行的 HTML/JS；E2EE 不阻止发布者替换代码。生产 HTTPS/WSS 保护代码分发和网络连接；localhost 的 HTTP/WS 仅限开发。

服务端不接收 `roomSecret` 或聊天明文。它知道 roomId、角色、连接/IP、时序、大小及生命周期；访问令牌只用于授权，不作为加密材料。

## 前端

- React 状态仅在当前页面内存保留聊天和会话；不写入 Cookie、localStorage、sessionStorage、IndexedDB 或离线缓存。
- 邀请 fragment 在启动时同步解析、校验并从 history 移除；加入动作之后才发送 B 令牌。
- 原生 Web Crypto 实现 HKDF 与 AES-GCM，协议细节见 [PROTOCOL.md](PROTOCOL.md)。
- WebSocket 不自动重连；连接关闭、销毁及过期都会触发统一清理。
- 消息使用 React 文本渲染，输入框按 UTF-8 字节数限制。

## 后端

单个 Go 进程管理所有房间。RoomManager 同步房间映射和状态转换；每个连接的读写责任明确，所有队列有上限，销毁幂等。没有聊天持久化，也不提供历史重放。

生命周期：

```text
created (0 authenticated peers permitted)
  -> waiting (first peer authenticated, its token consumed)
  -> ready (both authenticated, both tokens consumed)
  -> closed (destroy / any authenticated disconnect / TTL / fatal protocol error)
```

`created`、`waiting` 超过创建后 10 分钟仍未 ready 则过期。所有非 closed 状态超过创建后 30 分钟则过期。`closed` 原子标记、从映射移除、通知并关闭双方连接、释放队列及引用；重复 close 不 panic。

未经鉴权的连接失败或退出不能销毁正常房间，以免第三人导致拒绝服务。鉴权前严格限制消息大小、时间与资源。

## 分阶段安全底线

P1 已包含授权、单次令牌、严格 schema、明文/帧上限、Origin 校验、基本资源上限、超时和有界队列。不能将这些正确性要求推迟到 P1.5。

P1.5 扩展安全头、容量和限流策略、故障/竞态/负载验证、代理日志审查、非 root 只读容器及 TLS 自托管示例。

## 不支持

多实例/跨节点路由、持久化恢复、离线队列、重连、Service Worker、第三方资源和遥测。扩展这些能力需先更新 ADR、威胁模型、协议与测试。
