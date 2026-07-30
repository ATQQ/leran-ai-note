# my-harness 复习笔记（M0–M4）

> 目的：用一张图 + 几条心智模型，快速回忆「架构 / 交互 / 示例」。  
> 可交互页：[`web/review/index.html`](./web/review/index.html)（需 `npm run demo`）。  
> 细节真源：[`architecture.md`](./architecture.md) · [`PLAN.md`](./PLAN.md) · [`ROADMAP.md`](./ROADMAP.md)。

---

## 1. 一句话心智模型

| 命题 | 记住什么 |
|------|----------|
| Harness ≠ Prompt | Prompt 只建议；Loop / 校验 / 终止 / Context 裁剪由代码强制 |
| 内核无厂商协议 | `kernel/*` 只认 `UnifiedMessage` / `ToolCall` / `ToolResult`；`tool_calls`、`role:"tool"` 仅在 Adapter |
| 全量 vs 视图 | Loop **全量存** `messages`；`assembleContext` 只裁「发给模型的视图」；结果再写回全量 |
| 默认流式 | 文本/工具碎片边到边看；**完整 tool 参数解析完才执行** |
| SKILL 是规程文档 | 不是业务副作用；加载通道可以是 system 注入，也可以是 `load_skill` tool 回写 |

---

## 2. 分层架构

```text
浏览器  web/<stage>/          ← 演示壳：SSE、步骤/JSON、Trace 回放
            │  POST /api/run
            ▼
Server  server/index.ts       ← 读 .env、组 tools、挂 skills、写 traces/
            │
            ▼
Kernel  loop + context        ← 循环 / 裁剪视图 / 校验 / 终止
        + validate + tools
        + skills
            │  UnifiedMessage[]
            ▼
Adapter adapters/openai.ts    ← 统一类型 ↔ Chat Completions（stream）
```

| 本项目 | 对照 Pi | 职责 |
|--------|---------|------|
| `adapters/*` | `pi-ai` | 协议转换、流式解析 |
| `kernel/*` | `pi-agent-core` | Agent Loop、工具、Context、事件 |
| `server/` + `web/` | coding-agent 壳 | HTTP/SSE、密钥不出前端 |

---

## 3. Agent Loop 交互流程

```text
run_start
  → [可选] skill_inject（目录 / match|model 全文 / agent 只挂工具）
  → assembleContext(全量) → 视图
  → llm_request（带 before/after + openaiRequest）
  → stream_detail*（text / tool 碎片）+ text_delta*（UI）
  → assistant_message（完整 assistant，arguments 已是对象）
  → 若有 toolCalls：
        tool_start → validate → execute → tool_end
        把 ToolResult 写成 role:tool 消息 append 进全量
        → 再 llm_request …
  → 无 toolCalls → run_end（finalAnswer + stopReason）
```

### 终止原因（常见）

| `stopReason` | 触发 |
|--------------|------|
| `completed` | 正常结束（或工具错但未 `stopOnToolError`） |
| `max_steps` | 超过 `maxSteps` |
| `timeout` | `timeoutMs` |
| `aborted` | 前端取消 / AbortSignal |
| `tool_error` | 工具错且 `stopOnToolError=true` |
| `error` | 出站失败等（如 `fetch failed`） |

---

## 4. Context：全量轨迹 vs 出站视图

```text
内存 messages[]  ──(完整历史，含所有 tool 往返)──► Trace / 下一轮 append
        │
        │  assembleContext(strategy)
        ▼
   发给模型的 messages'   ← identity | recent_n | char_budget
        │                    + repairToolOrphans（避免拆散 tool 配对）
        ▼
   Adapter → openaiRequest（可在页面 JSON 面板对照）
```

| 策略 | 行为 |
|------|------|
| `identity` | 原样发出 |
| `recent_n` | 保留 system + 最近 N 条（并修孤儿） |
| `char_budget` | 按字符粗估裁到预算内 |

**示例心智**：历史很长时，Trace 里 `context.beforeCount` 可以很大，`afterCount` 很小——说明裁的是出站视图，不是把内存删掉。

---

## 5. SKILL 渐进披露（M4）

| 模式 `skillAuto` | 谁决定加载全文 | 全文怎么进 Context |
|------------------|----------------|--------------------|
| `off` | 人手勾选或 `/skill:name` | 二次写入 **system** |
| `match` | Harness 词重叠打分 | 二次写入 **system** |
| `model` | 分类请求返回 JSON | 二次写入 **system** |
| `agent`（对齐 Pi） | 模型调 `load_skill` | **tool 消息**回写纯 Markdown |

Pi 对照：目录常驻 system；模型用 `read` 读 `SKILL.md`。本项目用 `load_skill` 同构；成功结果是 **Markdown 正文**（非 JSON 壳）。

### 示例 skill

- `skills/weather-brief.md`：强制天气简报模板  
- `skills/add-checklist.md`：加法核对清单  

---

## 6. 事件 / Trace 速查

| `RunEvent.type` | 谁在说话 | 典型 payload |
|-----------------|----------|--------------|
| `run_start` | harness | 初始 messages、tools 数 |
| `skill_inject` | harness | catalog / auto / full_inject |
| `llm_request` | harness→model | `context` + `openaiRequest` |
| `stream_detail` | model | 工具/文本碎片；落盘 |
| `text_delta` | model | 仅推 UI，不落盘 |
| `assistant_message` | model | 完整 assistant |
| `tool_start` / `tool_end` | tool | name、args、result |
| `run_end` | harness | finalText、stopReason |
| `error` | harness | `{ error }` |

落盘：`traces/openai-latest.json`（密钥脱敏）。

---

## 7. 按里程碑复习 + 示例操作

### M1 · 流式循环

- **看什么**：协议时间线里同一 `index` 的 `arguments+=` 增长，再 `tool_parse_done`，然后才 `tool_start`。  
- **页**：[`web/m1-openai-loop/`](./web/m1-openai-loop/index.html)  
- **示例 prompt**：查天气再加法，观察多轮 tool 往返。

### M2 · 运行时约束

- **看什么**：`maxSteps=1` → `max_steps`；`localGuard=unknown_tool|bad_args` 不经模型也能测校验。  
- **页**：[`web/m2-guards/`](./web/m2-guards/index.html)

### M3 · Context

- **看什么**：编辑 `history[]`，切 `recent_n` / `char_budget`，对照 before/after 与 `openaiRequest`。  
- **页**：[`web/m3-context/`](./web/m3-context/index.html)

### M4 · SKILL

- **看什么**：`agent` 模式下步骤出现 `load_skill`；tool 结果是 Markdown；`match`/`model` 则是 system 二次注入。  
- **页**：[`web/m4-skill/`](./web/m4-skill/index.html)  
- **示例**：`深圳今天天气怎么样？给我一个规范汇报。`（agent / match 对照）

---

## 8. 类型边界（冻结）

内核只用：

- `UnifiedMessage`（`system|user|assistant|tool`）
- `ToolDef` / `ToolCall` / `ToolResult`
- `RunEvent` / `LlmAdapter`

`ToolCall.arguments` **始终是已解析对象**（Adapter 负责从流式字符串拼完再 `JSON.parse`）。

---

## 9. 常见坑（复习自检）

1. 以为 Context 裁剪会删掉内存历史 → 不会，只影响出站。  
2. 半截 tool JSON 就执行 → 本项目禁止；等 `tool_parse_done`。  
3. `load_skill` 回 JSON 壳 → 已改为纯 Markdown，对齐 Pi `read`。  
4. 从 Cursor 沙箱起 Server 带代理 → 出站 Ark 可能 `fetch failed`；本机终端起或清掉 `HTTP_PROXY`。  
5. 密钥进 Trace/前端 → 不允许；只在 Server 读 `.env`。

---

## 10. 下一步

- M5 MCP 桥（stdio → ToolDef）  
- M6 Anthropic Adapter（同场景第二厂商）  
- 闸门 V3–V6：本地跑通后在 `PLAN.md` / `ROADMAP.md` 勾选  
