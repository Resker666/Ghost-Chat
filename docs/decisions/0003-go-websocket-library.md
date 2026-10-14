# ADR 0003：Go WebSocket 依赖

日期：2026-10-14。状态：已接受。

## 决策

使用 `github.com/coder/websocket` v1.8.15，版本固定进 `go.mod` / `go.sum`。维护状态和版本由主代理选型时核验；上游为 [coder/websocket](https://github.com/coder/websocket)。依赖不是自研 WebSocket 实现，不替代应用层 Origin、鉴权、帧长度、期限或背压检查。

## 原因与后续

采用维护中的成熟库，减少帧处理、协议关闭和连接并发方面的自行实现。上层仍限制单个 writer、读取期限、有界发送队列并提供生命周期测试；升级需检查变更记录与安全公告，并重跑协议/中继/真实浏览器回归。
