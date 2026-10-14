# ADR 0004：JSON 重复字段与空消息边界

日期：2026-10-14。状态：已接受，P1.5。

## 决策

Go 与 TypeScript 均拒绝重复 JSON 属性，包含通过 Unicode escape 表示的同名键；未知字段、注释、尾逗号、嵌套值和未知版本一并拒绝。TypeScript 使用 Microsoft `jsonc-parser` 3.3.1 的本地 visitor 在 `JSON.parse` 前检查，解析模式禁用扩展 JSON 语法。

统一空消息策略：明文 1..2,048 字节 UTF-8、密文含 tag 17..2,064 字节。空白字符合法且不 trim；拒绝孤立 UTF-16 surrogate 和非法 UTF-8，保留前导 U+FEFF。

## 原因与验证

原生 JSON.parse 在重复字段时保留末值，可能与 Go 严格解析产生分歧。新增依赖按版本锁定、MIT 许可、本地打包，不引入远程资源或 unsafe-eval。增加重复/转义字段和边界测试；实际执行结果见开发记录。
