# 协议 v1

状态：v1 已实现并完成 P1 验证，P1.5 边界进一步对齐；各阶段实际结果见 [PROGRESS.md](PROGRESS.md)。所有消息是严格 JSON 对象，不接受未知或重复字段（包括转义后的同名键）、类型、版本、非法长度或非规范编码。聊天消息的版本号和 `cryptoVersion` 均为 1。

## 创建与邀请

`POST /api/v1/rooms` 不携带 E2EE 材料，响应：

```text
{roomId, creatorToken, inviteToken, expiresAt, idleTimeoutSeconds}
```

`expiresAt` 为 ISO 8601 时间。roomId 为 16 字节随机，两个独立令牌各 32 字节随机；服务端仅保存角色验证材料。响应为 `Cache-Control: no-store`。

邀请格式：`/r/<roomId>#s=<base64url-roomSecret>&t=<base64url-inviteToken>`。`roomSecret` 为浏览器生成的 32 字节随机材料。fragment 不发送服务端；启动立即解析并移除，不进持久化存储。B 明确点击加入后才发送令牌。

## 连接与控制消息

端点：`GET /api/v1/rooms/{roomId}/ws`。生产使用 WSS，令牌不得放入 query 或 header 日志。先做 Origin allowlist 检查，建立连接后首帧：

```json
{"v":1,"kind":"auth","token":"<role-token>"}
```

鉴权前不转发任何聊天数据，首帧鉴权期限为 5 秒。A/B 令牌各消费一次，服务端以令牌确定角色，不信任客户端自报角色。

服务端消息：

```text
{v:1, kind:"joined", role:"A"|"B", roomId, expiresAt}
{v:1, kind:"peer_ready"}
{v:1, kind:"room_destroyed", reason:"destroyed"|"disconnected"|"expired"|"protocol_error"|"slow_client"}
{v:1, kind:"error", code}
```

客户端销毁：`{v:1, kind:"destroy"}`。客户端不能发送服务端事件来伪造 ready、角色或结束原因。错误固定且不携带令牌、秘密、原始帧或堆栈。

## 加密信封

```json
{"v":1,"kind":"ciphertext","roomId":"<room-id>","direction":"A_TO_B","seq":1,"iv":"<base64url-12-bytes>","ciphertext":"<base64url-aead-output>"}
```

只允许 `A_TO_B` / `B_TO_A`，必须与已鉴权角色对应。双方 ready 后才允许发送。每方向序号为 1..10,000 的安全整数，从 1 开始；接收方只接受 `lastAcceptedSeq + 1`，检查通过认证后才提交接收序号状态。发送和接收分别串行；不自动重试，不复用 seq。

`roomSecret` 经 HKDF-SHA-256 派生各方向独立的不可导出 AES-256-GCM CryptoKey，长度 256 位。HKDF 输入材料为原始 32 字节 secret；不把 base64url 文本当作输入材料。

```text
salt = UTF8("GhostChat/crypto/v1/room/" + roomId)
info = UTF8("GhostChat/crypto/v1/key/" + direction)
```

`direction` 精确为 `A_TO_B` 或 `B_TO_A`。所有二进制字段使用规范无填充 base64url：仅 `A-Z a-z 0-9 _ -`，不含 `=`，解码后重新编码必须完全一致。roomId 解码为 16 字节；secret/token 为 32 字节；IV 为 12 字节；ciphertext 为 17..2,064 字节，包含 tag。

AES-GCM tag 长 128 位。每条 IV 为 CSPRNG 生成的 12 字节；每方向同一密钥最多发送 10,000 条，内存有界集合检测生成碰撞，已使用 IV 不复用。碰撞或无法继续保证唯一性时拒绝发送并终止会话。

AAD 是 `UTF8(JSON.stringify([1,"ciphertext",roomId,direction,seq]))`，无额外空白。每条明文为 1..2,048 字节 UTF-8，不接受空串，空格及其他空白字符仍合法且不 trim；密文包括 16 字节 tag。发送拒绝无法无损编码的孤立 UTF-16 surrogate；接收端 fatal UTF-8 解码并保留用户前导 U+FEFF，校验解密后字节上限，使用安全文本渲染。WebSocket frame 独立限制为最多 8 KiB。

解密、AAD、schema 或版本失败不显示消息并结束本地会话；不输出原始消息到日志。网络顺序不等于已经读到消息，本协议不提供已读、离线重传或恢复。

### 固定互通向量

以下全部是测试专用材料，可用于独立实现互通检查，不代表真实会话：

```text
roomSecret raw bytes = 00 01 02 ... 1f
roomId = AAECAwQFBgcICQoLDA0ODw
direction = A_TO_B
seq = 1
iv = AAECAwQFBgcICQoL
plaintext = Protocol v1 fixture
AAD = [1,"ciphertext","AAECAwQFBgcICQoLDA0ODw","A_TO_B",1]
ciphertext = a3UpqDvbedHqvEd-gyg2APjn2KqMn8vUe3dXEigSdeLtf_4
```

该向量由 Node/OpenSSL HKDF 与 AES-GCM 独立计算；浏览器实现仍须以实际测试核对，不能仅凭文档声称互通通过。

## 生命周期

- 从创建起 10 分钟内双方未到齐则过期；总 TTL 从创建起 30 分钟。
- 首次成功鉴权前允许零在线；之后任一已鉴权参与者断线立即销毁整房。
- 任一方 destroy、到期、致命协议错误或慢客户端触发同一幂等关闭路径。
- 未鉴权失败不得销毁已存在的正常房间。
- 关闭后移除房间及队列，双方清理页面状态；不重连，原令牌和邀请不可复用。
- 服务重启使所有房间失效。

以上 TTL 可配置并用测试时钟验证；客户端倒计时仅展示，服务端事件和关闭行为为权威。
