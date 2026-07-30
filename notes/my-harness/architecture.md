# my-harness 架构（M0 定稿）

## 分层对应

| 本项目 | Pi | 职责 |
|--------|-----|------|
| `adapters/*` | `pi-ai` providers | 统一类型 ↔ 厂商协议；默认流式 |
| `kernel/loop` + tools + assembleContext | `pi-agent-core` | 循环、工具执行、Context 钩子、事件 |
| `server/` + `web/` | coding-agent（产品壳） | HTTP/SSE 演示；密钥留在 Server |

## 数据流

```text
浏览器 (web/<stage>/index.html)
  │  POST /api/run  + fetch 读 SSE
  ▼
server/index.ts
  │  读 .env · 调 runAgent · 写 traces/
  ▼
kernel/loop.ts
  │  assembleContext(state) → UnifiedMessage[]
  │  adapter.stream(...) → text_delta + stream_detail + 完整 assistant
  │  若有 ToolCall → registry.execute → 回写 tool 消息 → 再请求
  ▼
adapters/openai.ts（一期）
```

## 事件对应（学习对照）

| function-call-demo phase | Pi 事件（近似） | 本项目 RunEvent.type |
|--------------------------|-----------------|----------------------|
| `init` | — | `run_start` |
| `request_model` | `turn_start` + 发往 LLM | `llm_request` |
| （流式增量） | `message_update` / `text_delta` | `text_delta`（推 UI，**不落盘**） |
| （流式解析细节） | — | `stream_detail`（工具碎片全记；文本仅汇总；**落盘**） |
| `model_response` | `message_end`（assistant） | `assistant_message` |
| `execute_tool` | `tool_execution_start` | `tool_start` |
| `append_tool_result` | `tool_execution_end` + toolResult message | `tool_end` |
| `final_answer` | `agent_end` | `run_end` |
| `error` | — | `error` |

### `stream_detail` 约定

| `payload.kind` | 含义 | Trace |
|----------------|------|-------|
| `tool_fragment` | 某一 SSE 帧的工具碎片（按 index 累加） | 全记 |
| `text_fragment` | 每一帧文本增量（`delta` + 自拼 `accContent`） | 全记 |
| `text_summary` | 本轮完整 content + 帧数统计 | 记 |
| `tool_parse_done` | 流结束、`arguments` 已 parse 为对象 | 记 |

M1 页：`协议时间线` 实时展示；加载 Trace 后重建轮次 + 时间线 + 卡片回放（非纯 JSON）。

## 目录

```text
notes/my-harness/
  src/types.ts
  src/kernel/loop.ts
  src/kernel/tools.ts
  src/adapters/openai.ts
  src/trace.ts
  src/load-env.ts
  server/index.ts
  web/
    shared/shared.css · shared.js
    index/index.html · index.css · index.js
    m1-openai-loop/
      index.html · style.css · main.js
      timeline.js · trace-view.js
    m2-guards/
      index.html · style.css · main.js
    m3-context/
      index.html · style.css · main.js
      history.js · steps.js
    m4-skill/
      index.html · style.css · main.js
  skills/
    weather-brief.md
    add-checklist.md
  traces/
```

### 前端约定（强制）

- 每阶段独立目录：`web/<name>/`。
- HTML / CSS / JS 分文件；HTML 不写大段内联脚本或样式。
- 公共能力放 `web/shared/`，页面用相对路径引用。

### 注释约定（强制）

- 使用**简体中文**详尽注释：文件头职责、公开 API、关键分支与协议边界。
- 细则见 ROADMAP §8.7。

## 类型边界（冻结）

- 内核只使用 `UnifiedMessage` / `ToolDef` / `ToolCall` / `ToolResult` / `RunEvent`。
- OpenAI 的 `tool_calls`、`role: "tool"` 仅出现在 Adapter。
- `ToolCall.arguments` 始终为已解析对象。

## M2 运行时约束

| 能力 | 位置 | 说明 |
|------|------|------|
| `maxSteps` | `loop` + 请求体 | 超限 → `stopReason=max_steps` |
| `timeoutMs` | `loop` 合并 AbortSignal | 到期 → `stopReason=timeout` |
| 前端取消 | `fetch` abort → `req.close` → signal | → `stopReason=aborted`；Trace 仍落盘 |
| schema 校验 | `kernel/validate.ts` | 未知工具 / 类型 / required → 错误 `ToolResult` |
| `stopOnToolError` | `loop` | true 时工具一错即停 → `tool_error` |
| 本地守卫演示 | `POST /api/run` + `localGuard` | 不经模型，确定性测 V3 |

## M3 Context 策略

| 能力 | 位置 | 说明 |
|------|------|------|
| `assembleContext` | `kernel/context.ts` → `loop` 发模型前 | 裁剪的是视图；内存完整轨迹保留 |
| `identity` / `recent_n` / `char_budget` | 同上 | 无 tokenizer；字符数为粗估 |
| tool 孤儿回补 | `repairToolOrphans` | 避免裁断 `tool` 与 `assistant.toolCalls` 配对 |
| Trace | `llm_request.payload.context` | before/after 条数与字符、preview 摘要 |
| 出站 JSON | `llm_request.payload.openaiRequest` | 真实 Chat Completions body（无 Key） |
| 页面历史 | `history[]` 优先于 `seedPairs` | m3 页可编辑构造 Context |

## M4 SKILL 渐进披露

| 能力 | 位置 | 说明 |
|------|------|------|
| 发现 | `skills/*.md` 或 `*/SKILL.md` | frontmatter: `name` / `description` |
| 第一层 | `skillCatalog` → system 目录摘要 | 仅元数据 |
| 第二层 | `injectSkills` 或 prompt `/skill:name` | 注入全文 |
| Trace | `skill_inject` 多阶段事件 | catalog → auto_match/model → full_inject |
| 自动二次注入 | `skillAuto=match\|model` | Harness 分析后注入全文到 system |
| Pi 风格 | `skillAuto=agent` + `load_skill` | 目录常驻；模型按需加载；tool 结果为 Markdown 正文（非 JSON 壳） |
| 演示 | `web/m4-skill/` | 步骤拆解 + 出站 JSON 回溯 |
