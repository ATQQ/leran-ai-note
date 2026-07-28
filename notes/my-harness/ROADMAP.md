# my-harness：学习与实施路线

## 目标与范围

在本仓库实现一个最小可运行的 Agent Harness，用于验证与巩固既有概念（Context、Function Calling、Harness、SKILL、MCP、安全边界）。

| 项 | 约定 |
|----|------|
| Provider（一期） | OpenAI Chat Completions 兼容接口 |
| 内核 | 仅使用统一数据结构；厂商协议细节封装在 Adapter |
| 对照实现 | [Pi（earendil-works/pi）](https://github.com/earendil-works/pi)：只读参考，不作为运行时依赖，不 fork |
| 实现位置 | `notes/my-harness/` |
| 演示入口 | **HTML 页面 + Node Server**（非 CLI）；多页面分别对应不同里程碑演示 |
| 前端结构 | **每阶段独立目录**；HTML / CSS / JS **分文件**，禁止大段内联脚本与样式 |
| 增量顺序 | 可运行循环（默认流式）与轨迹回放 → 运行时约束 → Context 策略 → SKILL → MCP → 第二 Provider →（可选）进阶 UI |
| 输出模式 | **默认流式**（Chat Completions `stream: true` / SSE）；经 Server 推送到浏览器；非流式仅作调试或降级选项 |

---

## 1. 既有资产

| 资产 | 路径 | 用途 |
|------|------|------|
| 概念要点 | `notes/knowledge/ai-app-interview/` | Context / Harness / SKILL / MCP / 安全 |
| Function Calling 演示 | `notes/function-call-demo/` | OpenAI 与 Anthropic 协议差异；Trace 与 Viewer |
| MCP stdio 演示 | `notes/mcp-demo/` | Tools / Resources / Prompts 最小 Server |
| SSE 笔记 | `notes/sse/` | 默认流式输出所依赖的协议基础 |
| Prompt / Tool Use 笔记 | `notes/agent/` | Prompt Engineering 基础 |

### 对照阅读（Pi）

本地若已克隆 Pi，可对照下列包；未克隆时以 GitHub 与官方文档为准。

| 包 | 仓库路径 | 关注点 |
|----|----------|--------|
| `@earendil-works/pi-ai` | `packages/ai/` | 统一 LLM API、Tool 定义、Provider 适配、thinking / usage |
| `@earendil-works/pi-agent-core` | `packages/agent/` | Agent 循环、状态、事件流、`transformContext` / `convertToLlm` |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent/` | CLI、Skills、Extensions（后期） |

Pi 分层：

```text
coding-agent（产品）
    ↓
agent-core（循环、状态、事件）
    ↓
pi-ai（Provider 适配、统一消息）
```

本项目目标分层：

```text
web/（HTML 演示页，按里程碑拆分）
    ↓ HTTP / SSE
server/（Node：静态资源 + 调用 kernel 的 API）
    ↓
kernel（统一 Message / Tool / Loop / Trace）
    ↓
adapters/openai（一期唯一适配器）
```

演示约定：

- 浏览器只负责输入、展示流式增量与 Trace；密钥与模型调用留在 Node Server。
- 每个主要里程碑对应独立目录下的页面，便于对照该阶段能力，互不挤在同一页。
- Server 提供统一的 run / stream 接口；页面通过路径选择场景（如 `m1-openai-loop`、`m2-guards`）。
- **前端分文件约定（强制）**：见第 8 节。

---

## 2. 学习目标

完成各阶段后，应能结合代码说明下列要点：

- [ ] 分层：Model、Tools（声明与实现）、Context、Harness、Agent
- [ ] Function Calling：以结构化 `tool_calls` 为准；`tool_choice`、JSON Schema、`additionalProperties`
- [ ] Agent Loop：请求 → 解析调用 → 校验 → 执行 → 回写 → 再请求；步数 / 超时等强制终止
- [ ] Context Engineering：窗口内容的取舍；截断与摘要由 Harness 负责
- [ ] SKILL：渐进披露；发现 → 注入 Context → 按规程执行
- [ ] MCP：作为 Tool 后端之一；stdio 生命周期与 schema 来源
- [ ] 安全：密钥不进入 Context；schema 校验；权限控制；轨迹脱敏
- [ ] Provider 适配：统一结构与厂商协议的双向转换；OpenAI 兼容面优先；**默认流式**

---

## 3. 里程碑总览

```text
M0  对照与模块图
M1  统一内核 + OpenAI Adapter（默认流式、可运行、可回放）
M2  运行时约束（maxSteps、超时、schema 校验、错误回写）
M3  Context 组装与裁剪钩子
M4  SKILL 发现与注入
M5  MCP Tool 桥接
M6  Anthropic Adapter（验证统一结构；默认流式）
M7  （可选）权限门闩、reasoning 增量等进阶能力
```

每一阶段包含学习、实现与验证三项。验证未通过则不进入下一阶段。

---

## 4. 分阶段说明

### M0 · 对照与模块图（约 0.5–1 日）

**学习**

1. 阅读 Pi `packages/agent/README.md`：`AgentMessage` 与 LLM Message、`prompt()` 事件序列、含 Tool 的循环。
2. 阅读 `packages/ai/README.md` 中 Tools、Stop Reasons、OpenAI Compatibility 相关章节。
3. 对照 `notes/knowledge/ai-app-interview/conclusions.md` 中 Function Calling 与 Harness 章节。

**实现**

- 维护本文「模块图」或独立 `architecture.md`。
- 定稿统一数据结构（见第 5 节）。

**验证**

- [ ] 能说明 Pi 三包与本项目三层的对应关系。
- [ ] 能指出 `function-call-demo` 轨迹步骤与 Pi `tool_execution_*` 类事件的对应关系。

**建议阅读（只读）**

- `packages/agent/README.md`
- `packages/agent/src/` 中 Agent 与循环相关实现（以 README 为索引）
- `packages/ai` 中 OpenAI 兼容 Provider 实现

---

### M1 · 统一内核与 OpenAI Adapter（约 2–3 日）

**学习**

- 运行 `notes/function-call-demo`：`npm run openai` 与 `npm run viewer`。
- 阅读 `notes/sse/`：SSE 帧格式与 `stream: true` 下的增量解析。
- 对照 Pi：流式 `message_update` / tool call 增量，以及发往 LLM 前的 `convertToLlm`（或等价步骤）。

**实现**

建议目录：

```text
notes/my-harness/
  README.md
  ROADMAP.md
  package.json
  .env.example
  src/
    types.ts
    kernel/loop.ts
    kernel/tools.ts
    adapters/openai.ts
    trace.ts
  server/
    index.ts               # 静态资源 + /api/run（SSE）等
  web/
    shared/
      shared.css           # 公共样式
      shared.js            # 公共工具（如 SSE fetch）
    index/
      index.html
      index.css
      index.js
    m1-openai-loop/
      index.html
      style.css
      main.js
    m2-guards/             # M2 起补充
    m3-context/
    m4-skill/
    m5-mcp/
    m6-anthropic/
  traces/
```

- 本地 mock 工具可复用 `get_weather`、`add`（逻辑可参考 `function-call-demo`）。
- 环境变量采用 OpenAI 兼容约定：`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`（仅 Server 读取）。
- **默认流式**：Adapter 使用 `stream: true`；Server 将 text delta / 工具起止 / 最终 Trace 以 **SSE**（或等价分块响应）推送给对应 HTML 页。
- HTML 页发起请求（如 `POST /api/run` + `fetch` 读流）；展示增量文本、工具调用摘要，并可加载或内嵌 Trace 回放。
- 非流式仅作为 Server 可选查询参数，用于排障，不得作为默认路径。
- 启动方式示例：`npm run demo` → `http://127.0.0.1:<port>/web/index/index.html`。

**验证**

- [ ] 固定用户请求可完成「多工具调用 → 最终文本答复」。
- [ ] 浏览器页面可见流式文本增量；工具调用在流段结束后完整解析并执行。
- [ ] 生成 `traces/*-latest.json`；同页或独立回放区可逐步查看；字段可与 `function-call-demo` Viewer 对齐。
- [ ] `kernel/loop.ts` 不出现 OpenAI 专有字段名（如 `tool_calls`、`role: "tool"`）；此类字段仅出现在 Adapter。
- [ ] 密钥不出现在前端代码或响应头明文中。

---

### M2 · 运行时约束（约 1–2 日）

**学习**

- 结论库中 Harness 强制项（步数、超时、取消）与 Prompt 可选项的区分。
- Pi 中工具执行起止事件及错误回写入消息列表的方式。

**实现**

- `maxSteps`、`timeoutMs`、`AbortSignal`（支持前端取消 → Server abort）。
- 执行前按 schema 校验工具名与参数；拒绝未知工具与非法 JSON。
- 工具执行失败时写入带错误信息的 ToolResult 并回写上下文（是否中止整次运行可配置）。
- 补充 `web/m2-guards/`（`index.html` + `style.css` + `main.js`）：可调节 maxSteps、触发非法工具等对照场景。

**验证**

- [ ] 错误参数或未知工具名产生明确 ToolResult；循环按策略继续或停止；页面可展示错误事件。
- [ ] `maxSteps=1` 时强制终止，Trace 记录终止原因。

---

### M3 · Context 策略（约 1–2 日）

**学习**

- Context 构成：system、历史、工具结果、可选 SKILL。
- Pi：`transformContext` → `convertToLlm` 管线。

**实现**

- `assembleContext(state) → UnifiedMessage[]`（可替换）。
- 基线策略：保留 system 与最近 N 条消息；或按字符数近似截断（可不引入 tokenizer）。
- 补充 `web/m3-context/`：展示裁剪前后条数与发往模型的 messages 摘要。

**验证**

- [ ] 在较长历史下，实际发往模型的 messages 缩短；Trace 记录裁剪前后条数。
- [ ] 密钥与工具实现代码不进入 messages。

---

### M4 · SKILL 注入（约 1–2 日）

**学习**

- SKILL 渐进披露；与 MCP 的职责划分（规程文档 vs 能力通道）。
- Pi coding-agent 的 Skills 机制（文档级）。

**实现**

- `skills/*.md`（frontmatter：`name`、`description`）。
- 发现结果写入 system 摘要；按命令或匹配规则注入全文。
- 补充 `web/m4-skill/`：开关 SKILL 加载并对照行为差异。

**验证**

- [ ] 相同固定 prompt 下，未加载与已加载 SKILL 的行为差异符合规程。
- [ ] Trace 记录所注入的 SKILL 标识。

---

### M5 · MCP 工具桥（约 1–2 日）

**学习**

- 运行 `notes/mcp-demo` 与 MCP Inspector。
- MCP Tool schema → 统一 `ToolDef`；`call_tool` → 统一 `ToolResult`。

**实现**

- 连接 stdio MCP Server；`list_tools` 注册到工具表；执行经 MCP。
- 补充 `web/m5-mcp/`：展示 MCP 工具列表与调用结果。

**验证**

- [ ] 可调用 mcp-demo 的 `echo` / `add`，结果回写正确。
- [ ] MCP 进程不可用时返回明确错误 ToolResult，不得静默失败。

---

### M6 · Anthropic Adapter（约 1–2 日）

**学习**

- 使用 Viewer 对照 `function-call-demo` 的 OpenAI 与 Anthropic 轨迹。

**实现**

- `adapters/anthropic.ts`：`tool_use`、`tool_result`、`input_schema`；**默认流式**（Anthropic Messages stream）。
- `loop.ts` 保持与 Provider 无关；仅切换注入的 Adapter。
- 补充 `web/m6-anthropic/`：同一提示词切换 / 对照 Anthropic Adapter。

**验证**

- [ ] 同一演示场景更换 Adapter 可完成运行（含流式增量，经 HTML 页展示）。
- [ ] 内核类型定义不泄漏 Anthropic 专有字段。

---

### M7 · 可选增强

- 权限控制：高风险工具需前端确认后再由 Server 执行（见结论库安全章节）。
- reasoning / thinking 增量展示；工具参数流式 JSON 的部分解析（若 Provider 支持）。
- Trace 回放组件与 `function-call-demo/viewer.html` 能力对齐或复用。

---

## 5. 统一数据结构（M0 / M1 定稿）

Harness 内核仅依赖下列语义（字段名可微调）：

```ts
type Role = "system" | "user" | "assistant" | "tool";

interface UnifiedMessage {
  role: Role;
  content: string | null;
  toolCalls?: ToolCall[];   // assistant 发起的调用
  toolCallId?: string;      // tool 结果与调用的绑定
  name?: string;            // 可选：工具名
  // reasoning?: string;    // 可选：对应推理过程字段，不作为最终答复
}

interface ToolDef {
  name: string;
  description: string;
  parameters: object;       // JSON Schema；建议 additionalProperties: false
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>; // 已解析对象，而非 JSON 字符串
}

interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

interface RunEvent {
  // 与现有 Viewer 的 phase / title / actor / payload 对齐
  // 流式场景可含 text_delta 等增量事件（写入 Trace 时可汇总，避免刷屏）
}
```

### Adapter 边界

| 方向 | OpenAIAdapter |
|------|----------------|
| 出站 | `UnifiedMessage[]` + `ToolDef[]` → `messages` + `tools` + `tool_choice`；**默认** `stream: true` |
| 入站（流式） | 解析 SSE / chunk → 文本增量回调 + 流结束时的完整 `UnifiedMessage`（`arguments` 已解析为对象） |
| 入站（非流式，可选） | `choices[0].message` → `UnifiedMessage` |

---

## 6. 模块图

```text
┌─────────────────────────────────────────────────────────┐
│  web/<stage>/（每阶段独立目录：index.html + css + js）     │
│  输入 prompt → 展示 SSE 增量 / 工具事件 / Trace 回放       │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP + SSE
┌───────────────────────────▼─────────────────────────────┐
│  server/（Node）                                         │
│  静态资源 · /api/run · 读 .env · 写 traces/               │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  kernel/loop                                             │
│  循环至无 ToolCall 或达到终止条件                          │
│  hooks: assembleContext / onEvent / guards               │
└─────────────┬─────────────────────────────┬─────────────┘
              │                             │
┌─────────────▼─────────────┐   ┌───────────▼─────────────┐
│  adapters/openai          │   │  tools registry         │
│  stream(默认) / complete  │   │  local mock | MCP bridge│
└───────────────────────────┘   └─────────────────────────┘
```

### 演示页与里程碑对应（约定）

| 目录 | 阶段 | 演示重点 |
|------|------|----------|
| `web/index/` | — | 索引各阶段入口 |
| `web/m1-openai-loop/` | M1 | 统一内核、OpenAI、默认流式、基础 Trace |
| `web/m2-guards/` | M2 | maxSteps、校验失败、错误回写 |
| `web/m3-context/` | M3 | Context 裁剪前后对比 |
| `web/m4-skill/` | M4 | SKILL 注入开关 |
| `web/m5-mcp/` | M5 | MCP 工具桥 |
| `web/m6-anthropic/` | M6 | 第二 Adapter |

每个阶段目录固定文件：

| 文件 | 职责 |
|------|------|
| `index.html` | 结构与语义标签；只引用 CSS/JS，不写大段内联脚本/样式 |
| `style.css`（或 `index.css`） | 本页局部样式 |
| `main.js`（或 `index.js`） | 本页逻辑；`type="module"`，可 import `../shared/*` |

### 与 Pi 的对应关系

| 本项目 | Pi |
|--------|-----|
| `adapters/*` | `pi-ai` providers |
| `kernel/loop` 与状态 | `pi-agent-core` Agent |
| `server/` + `web/` | 产品壳（对应 coding-agent 的演示向替代；浏览器 + Node，而非 TUI） |
| `assembleContext` | `transformContext` + `convertToLlm` |
| 页面内 Trace / SSE 事件 | Pi 事件订阅的学习向替代 |

---

## 7. 验证矩阵

| ID | 场景 | 期望 | 阶段 |
|----|------|------|------|
| V1 | 多工具演示请求 | 经 `m1` 页默认流式展示；多次工具调用后得到最终文本 | M1 |
| V2 | Trace 回放 | 同页或回放区可逐步查看请求、响应与回写 | M1 |
| V3 | 未知工具名或非法参数 | 校验失败或错误 ToolResult | M2 |
| V4 | `maxSteps` | 强制停止，Trace 含终止原因 | M2 |
| V5 | 较长历史 | 发往模型的 messages 经裁剪 | M3 |
| V6 | 加载 SKILL | 行为符合规程，Trace 可审计 | M4 |
| V7 | MCP `add` / `echo` | 远程工具可调用 | M5 |
| V8 | 切换 Anthropic Adapter | 同场景可运行（默认流式）；内核无协议泄漏 | M6 |

---

## 8. 工作约定

1. Pi 仅作对照阅读；不向本仓库复制大段源码。设计要点可记入笔记并注明参考路径。
2. 实现代码位于 `notes/my-harness/`。
3. 密钥置于 `.env`（已忽略）；不写入版本库；Trace 中密钥须脱敏（策略对齐 `function-call-demo`）。
4. 每阶段结束后更新本文勾选状态，并在 `README.md` 用简短条目记录阶段结论。
5. 稳定后的设计要点可回写 `notes/knowledge/ai-app-interview/`。
6. **前端页面结构（强制）**：
   - 每个里程碑（及索引）使用独立目录：`web/<name>/`。
   - HTML / CSS / JS **分文件维护**；HTML 内禁止大段 `<script>` / `<style>`（仅允许必要的外链引用）。
   - 公共能力放 `web/shared/`；页面通过相对路径 `import` / `link` 引用，便于编辑器代码提示与复用。
   - 后续阶段（M2+）新建演示页时必须遵循本结构，不得再回退为单文件 HTML。

---

## 9. 时间安排（参考）

| 周期 | 内容 |
|------|------|
| 第 1 周 | M0、M1、M2 |
| 第 2 周 | M3、M4 |
| 第 3 周 | M5、M6 |
| 机动 | M7；要点回写 knowledge |

---

## 10. 当前下一步

1. ~~确认统一类型字段命名与实现语言（建议 TypeScript）。~~ 已采用 TS（Node strip-types）。
2. ~~完成 M0。~~ 见 `architecture.md`。
3. ~~进入 M1。~~ 已通过 V1/V2；下一步 **M2**：maxSteps / schema 校验 / 取消 + `web/m2-guards/`。

---

## 11. 相关路径

| 说明 | 路径 |
|------|------|
| Pi（上游） | https://github.com/earendil-works/pi |
| Function Calling 演示 | `notes/function-call-demo/` |
| MCP 演示 | `notes/mcp-demo/` |
| 概念要点 | `notes/knowledge/ai-app-interview/conclusions.md` |
| 复习页 | `notes/knowledge/ai-app-interview/review.html` |
