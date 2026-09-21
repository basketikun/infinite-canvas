# Hosted Codex Runtime

权威规格：[docs/design/hosted-codex-runtime.md](../../docs/design/hosted-codex-runtime.md)

PR 分支：`feat/hosted-codex-runtime`

已落地：RuntimeAdapter、User×Project 目录隔离、Conversation↔Thread、JWT runtime token、loopback MCP、只读沙箱、崩溃重建 resume、同 Runtime 并行 Conversation。

本目录 tickets 只覆盖对照规格后仍缺的缺口。不要发明 idle recycle / TTL / 超时。不要把托管 snapshot 写成已支持云同步。不要改 `canvas-agent/`、研究 Skill、或其它无关 WIP。
