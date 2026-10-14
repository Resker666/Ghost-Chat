# ADR 0002：浏览器加密 v1

日期：2026-10-14。状态：已接受。

## 决策

使用浏览器原生 Web Crypto，256 位本地 roomSecret，经 HKDF-SHA-256 派生 A→B/B→A 独立、不可导出的 AES-256-GCM 密钥。协议 v1 不提供前向保密。

使用 96 位随机 IV、128 位 tag；每方向最多 10,000 条，以有界集合检测已使用 IV。AAD 为 UTF-8 编码的版本/消息类型/roomId/方向/seq 的规范 JSON 数组。解密验证成功后才提交接收 seq。

HKDF salt 为 `UTF8("GhostChat/crypto/v1/room/" + roomId)`，info 为 `UTF8("GhostChat/crypto/v1/key/" + direction)`。完整编码、序号规则和固定测试向量见协议文档。

roomSecret 通过 fragment 带外分享，不上传、不持久化；传输访问令牌独立且服务端仅留验证材料。严格 schema、大小/编码、方向及序号检查属于协议正确性。

## 原因与代价

标准原语减少密码学实现风险；方向分离避免双方共享同一 AEAD 密钥/IV 空间。随机 nonce 方案仍依赖 CSPRNG、碰撞检测和消息上限。完整协议未经审计，不能因使用标准原语就称已审计安全。
