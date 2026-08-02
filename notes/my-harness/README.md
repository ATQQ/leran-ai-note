# my-harness

最小 Agent Harness 实验项目：在本仓库内实现，用于验证 Context、Function Calling、Harness、SKILL、MCP 等要点。设计对照 [Pi](https://github.com/earendil-works/pi)，不将其作为运行时依赖。

| 文档 | 说明 |
|------|------|
| [ROADMAP.md](./ROADMAP.md) | 学习目标、里程碑、统一数据结构、验证矩阵 |
| [PLAN.md](./PLAN.md) | 实施与验证步骤表（按序执行与闸门勾选） |
| [architecture.md](./architecture.md) | M0 定稿：分层、数据流、事件对应 |
| [REVIEW.md](./REVIEW.md) | M0–M4 复习笔记（架构 / 流程 / 示例）；HTML：[`web/review/`](./web/review/index.html) |

## 快速开始

```bash
cd notes/my-harness
cp .env.example .env   # 填写 OPENAI_*（可与 function-call-demo 共用同一套）
npm run demo
# 浏览器打开 http://127.0.0.1:8787/web/index/index.html
```

## 演示入口

- **HTML + Node Server**（非 CLI）；`web/<stage>/` 按里程碑拆目录；`server/` 静态资源 + SSE `/api/run`。
- **前端强制**：每阶段独立目录；HTML / CSS / JS 分文件；公共能力在 `web/shared/`（见 ROADMAP §8）。
- **注释强制**：源码使用简体中文详尽注释（模块职责、关键步骤、协议边界）；见 ROADMAP §8.7。
- 模型默认 `stream: true`；密钥仅 Server 读取 `.env`。

## 阶段结论

- **M0**：定稿统一类型与分层；见 `architecture.md`。
- **M1**：`kernel/loop` + `adapters/openai`（默认流式）+ `web/m1-openai-loop/`；固定多工具 prompt 可完成循环；`stream_detail` 协议时间线；Trace 卡片回放并可重建过程。闸门 V1/V2 已本地验证。
- **M2**：`maxSteps` / `timeoutMs` / 取消 abort；`kernel/validate.ts` 执行前 schema 校验；`stopOnToolError`；`web/m2-guards/` 场景页（含不经模型的 `localGuard`）。闸门 V3/V4 待你本地勾选。
- **M3**：`kernel/context.ts`（identity / recent_n / char_budget）+ `llm_request` Trace 记录裁剪前后条数；`web/m3-context/` 对照页；`seedPairs` 灌长历史。闸门 V5 待本地勾选。
- **M4**：`skills/*.md` + `kernel/skills.ts` 渐进披露（目录 → 全文）；`skill_inject` Trace；`web/m4-skill/` 开关对照。闸门 V6 待本地勾选。
- **M5**：双 Host 后端对照——手写 JSON-RPC（`stdio-client`）与官方 SDK（`sdk-client`）共用 `McpHostClient`；多 Server + 远程 Streamable HTTP；`web/m5-mcp/`。闸门 V7 待本地勾选。
- **M6**：跳过 Anthropic Adapter。
- **M7**：高风险确认门闩（`wipe_demo` / `write_file`）+ `reasoning_delta` + 工具参数 `partialArgs` 预览 + Trace 步进播放器；`web/m7-enhancements/`。
