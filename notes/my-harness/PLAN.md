# my-harness：实施与验证计划

依据 [ROADMAP.md](./ROADMAP.md)。**闸门规则**：本阶段「验证」全部勾选后，才进入下一阶段。

| 约定 | 内容 |
|------|------|
| 语言 | TypeScript（Node） |
| 入口 | `web/<stage>/` HTML + `server/`（非 CLI）；默认 SSE 流式 |
| 前端 | **每阶段独立目录**；HTML / CSS / JS 分文件；公共能力在 `web/shared/` |
| 注释 | **中文详尽注释**（模块职责、关键步骤、协议边界）；见 ROADMAP §8.7 |
| 密钥 | 仅 Server 读 `.env`；前端与 Trace 脱敏 |
| 对照 | Pi 只读；不复制大段源码、不作运行时依赖 |

---

## 总览（按执行顺序）

| 序 | 阶段 | 产出要点 | 闸门验证 | 估时 |
|----|------|----------|----------|------|
| 0 | M0 对照与定稿 | 类型草案、目录定稿、`architecture.md` | 能口述分层与事件对应 | 0.5–1 日 |
| 1 | M1 内核 + OpenAI | 可运行流式循环 + Trace | V1、V2 + 内核无协议泄漏 | 2–3 日 |
| 2 | M2 运行时约束 | maxSteps / 校验 / 取消 | V3、V4 | 1–2 日 |
| 3 | M3 Context 策略 | `assembleContext` + 裁剪 Trace | V5 | 1–2 日 |
| 4 | M4 SKILL | 发现 + 注入开关页 | V6 | 1–2 日 |
| 5 | M5 MCP 桥 | stdio → ToolDef / ToolResult | V7 | 1–2 日 |
| 6 | M6 Anthropic | 第二 Adapter，同场景可跑 | V8 | 1–2 日 |
| 7 | M7（可选） | 权限门闩 / thinking / Trace 增强 | 自定 | 机动 |

**周节奏（参考）**：第 1 周 M0–M2 → 第 2 周 M3–M4 → 第 3 周 M5–M6 → 机动 M7 + 回写 knowledge。

---

## M0 · 对照与定稿

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 0.1 | 读 Pi `packages/agent/README.md`（AgentMessage / prompt 事件 / Tool 循环） | 能画出一次 `prompt()` 的事件序列 |
| 0.2 | 读 Pi `packages/ai`：Tools、Stop Reasons、OpenAI Compatibility | 能说明 Adapter 出入站边界 |
| 0.3 | 对照 `notes/knowledge/ai-app-interview/conclusions.md` FC / Harness 节 | 能区分 Harness 强制项 vs Prompt 可选项 |
| 0.4 | 对照 `function-call-demo` 轨迹步骤 ↔ Pi `tool_execution_*` | 写出一张对应表（记入 architecture 或笔记） |
| 0.5 | 定稿统一类型（见 ROADMAP §5）：`UnifiedMessage` / `ToolDef` / `ToolCall` / `ToolResult` / `RunEvent` | 字段名不再摇摆；`arguments` 为对象 |
| 0.6 | 写出 `architecture.md`（或更新 ROADMAP §6）：目录 + 数据流 + 演示页映射 | 可直接按图建目录 |

### 验证闸门

| 检查项 | 通过条件 |
|--------|----------|
| 分层对应 | 能说明 Pi 三包 ↔ 本项目 `adapters` / `kernel` / `server+web` |
| 事件对应 | 能指出 FC demo 轨迹步骤与 Pi tool 事件的对应 |
| 类型冻结 | §5 类型可作为 `src/types.ts` 直接落地 |

**通过后**：进入 M1，禁止再改核心语义（仅允许字段微调并同步文档）。

---

## M1 · 统一内核 + OpenAI Adapter（默认流式）

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 1.1 | 建工程：`package.json`、`.env.example`、`tsconfig`（按需）、目录骨架 | 与 ROADMAP 建议目录一致 |
| 1.2 | `src/types.ts`：落地统一类型 | 与 M0 定稿一致 |
| 1.3 | `src/kernel/tools.ts`：工具注册表；本地 mock `get_weather`、`add` | 按 name 可执行并返回 `ToolResult` |
| 1.4 | `src/adapters/openai.ts`：出站转换；`stream: true`；入站增量 + 完整 assistant 消息 | 流结束时 `arguments` 已解析为对象 |
| 1.5 | `src/kernel/loop.ts`：请求 → 解析调用 → 执行 → 回写 → 再请求，直至无 tool_calls | **文件内无** `tool_calls` / `role:"tool"` 等 OpenAI 专有名 |
| 1.6 | `src/trace.ts`：写 `traces/*-latest.json`；密钥脱敏 | 字段可与 FC demo Viewer 对齐 |
| 1.7 | `server/`：静态资源 + `POST /api/run`（SSE）；读 env；调 kernel | 密钥不进响应头/前端 |
| 1.8 | `web/index/` + `web/m1-openai-loop/`（HTML/CSS/JS 分文件 + shared） | 可见文本 delta、工具摘要、Trace 回放区 |
| 1.9 | `npm run demo` 可启动 | `http://127.0.0.1:<port>/web/index/index.html` |

### 验证闸门（对应 V1、V2）

| ID | 操作 | 期望 |
|----|------|------|
| V1 | 固定多工具 prompt（经 m1 页） | 多次工具调用后得到最终文本；页面有流式增量 |
| V1b | 观察工具时机 | 工具在流段结束后完整解析再执行（非半截 JSON 就执行） |
| V2 | 打开 Trace / 回放 | 可逐步看请求、响应、回写 |
| V1c | 扫 `kernel/loop.ts` | 无 OpenAI 专有字段名 |
| V1d | 扫前端与网络面板 | 无 API Key 明文 |

**通过后**：更新 README 阶段结论；勾选 ROADMAP 学习目标中「分层 / FC / Loop / 默认流式」相关项。

---

## M2 · 运行时约束

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 2.1 | `maxSteps`、`timeoutMs`、`AbortSignal`（前端取消 → Server abort） | 超限/取消写入 Trace 终止原因 |
| 2.2 | 执行前 schema 校验：未知工具名、非法 JSON / 不合 schema | 拒绝并产生明确错误 `ToolResult`（或等价事件） |
| 2.3 | 工具失败回写；是否中止整次 run 可配置 | 循环按策略继续或停止 |
| 2.4 | `web/m2-guards/`（`index.html` + `style.css` + `main.js`）：可调 maxSteps、触发非法工具等场景 | 页面能展示错误与终止事件 |

### 验证闸门（对应 V3、V4）

| ID | 操作 | 期望 |
|----|------|------|
| V3 | 未知工具名或非法参数 | 明确 ToolResult / 错误事件；不静默吞掉 |
| V4 | `maxSteps=1` | 强制终止；Trace 含终止原因 |
| V4b | 运行中取消 | Server abort；页面有取消反馈 |

**通过后**：勾选学习目标「Agent Loop 强制终止」与安全中的 schema 校验项。

---

## M3 · Context 策略

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 3.1 | `assembleContext(state) → UnifiedMessage[]`（可替换钩子） | loop 发模型前只走该钩子 |
| 3.2 | 基线策略：保留 system + 最近 N 条，或按字符近似截断 | 不引入 tokenizer 亦可 |
| 3.3 | Trace 记录裁剪前后条数（及可选摘要） | 可审计 |
| 3.4 | `web/m3-context/`：展示裁剪前后条数与发往模型的 messages 摘要 | 对照一目了然 |

### 验证闸门（对应 V5）

| ID | 操作 | 期望 |
|----|------|------|
| V5 | 构造较长历史后跑一次 | 实际发往模型的 messages 缩短；Trace 有前后条数 |
| V5b | 检查 messages 内容 | 无密钥、无工具实现源码 |

**通过后**：勾选「Context Engineering」学习目标。

---

## M4 · SKILL 注入

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 4.1 | `skills/*.md`（frontmatter：`name`、`description`） | 至少 1 个可演示规程 |
| 4.2 | 发现：目录写入 system 摘要；按命令/匹配注入全文 | 符合渐进披露 |
| 4.3 | Trace 记录注入的 SKILL 标识 | 可审计 |
| 4.4 | `web/m4-skill/`：开关加载并对照 | 同 prompt 行为差异可见 |

### 验证闸门（对应 V6）

| ID | 操作 | 期望 |
|----|------|------|
| V6 | 同一固定 prompt：关 / 开 SKILL | 行为差异符合规程 |
| V6b | 查 Trace | 有 SKILL 标识 |

**通过后**：勾选「SKILL」学习目标。

---

## M5 · MCP 工具桥

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 5.1 | 跑通 `notes/mcp-demo` +（可选）MCP Inspector | 本地 Server 可用 |
| 5.2 | stdio 连接；`list_tools` → 统一 `ToolDef` 注册 | schema 来源清晰 |
| 5.3 | `call_tool` → 统一 `ToolResult`；进程不可用时显式错误 | 不得静默失败 |
| 5.4 | `web/m5-mcp/`：工具列表 + 调用结果 | 演示完整 |

### 验证闸门（对应 V7）

| ID | 操作 | 期望 |
|----|------|------|
| V7 | 调用 mcp-demo `echo` / `add` | 结果回写正确 |
| V7b | 停掉 MCP 进程再调 | 明确错误 ToolResult |

**通过后**：勾选「MCP」学习目标。

---

## M6 · Anthropic Adapter

### 实施步骤

| # | 动作 | 完成标准 |
|---|------|----------|
| 6.1 | 用 FC demo Viewer 对照 OpenAI vs Anthropic 轨迹 | 清楚 `tool_use` / `tool_result` / `input_schema` |
| 6.2 | `adapters/anthropic.ts`：双向转换；默认 Messages stream | 入站落成统一类型 |
| 6.3 | loop 仅换 Adapter 注入，不改内核类型 | `loop.ts` 仍无厂商字段 |
| 6.4 | `web/m6-anthropic/`：同提示词切换/对照 | 流式增量可见 |

### 验证闸门（对应 V8）

| ID | 操作 | 期望 |
|----|------|------|
| V8 | 同场景换 Anthropic Adapter | 可完成运行（含流式） |
| V8b | 扫内核类型与 loop | 无 Anthropic 专有字段泄漏 |

**通过后**：勾选「Provider 适配」学习目标；核心路径闭环完成。

---

## M7 · 可选增强（不阻塞主线）

| # | 项 | 验证建议 |
|---|-----|----------|
| 7.1 | 高风险工具前端确认后再执行 | 未确认不执行；Trace 有拒绝/确认记录 |
| 7.2 | reasoning / thinking 增量展示 | 页面可区分推理与最终答复 |
| 7.3 | 工具参数流式 JSON 部分解析（若 Provider 支持） | 不破坏「流结束后再执行」的安全默认 |
| 7.4 | Trace 回放与 `function-call-demo/viewer.html` 对齐或复用 | 同能力可演示 |

---

## 每日执行模板（建议）

每完成一个里程碑内步骤时：

1. **做**：按上表 `#` 顺序实现，单步可跑再进下一步。
2. **验**：跑该阶段闸门表；失败则修，不跨阶段。
3. **记**：勾选本文件与 ROADMAP；`README.md` 追加 1–3 条阶段结论。
4. **（可选）** 稳定要点回写 `notes/knowledge/ai-app-interview/`。

### 固定演示请求（建议写死，便于回归）

| 用途 | 建议内容 |
|------|----------|
| M1/V1 | 「先查某地天气，再把两个数相加，最后用中文总结」→ 触发 `get_weather` + `add` |
| M2/V3 | 故意传错误参数 / 诱导未知工具名 |
| M2/V4 | UI 设 `maxSteps=1` 仍发多工具意图 |
| M3/V5 | 先灌入多轮长历史再发新问题 |
| M4/V6 | 同一句 prompt，关/开某个 skill |
| M5/V7 | 「用 MCP 的 add/echo …」 |
| M6/V8 | 与 V1 相同 prompt，仅换 Adapter |

---

## 当前进度

| 阶段 | 状态 |
|------|------|
| M0 | 完成（`architecture.md`） |
| M1 | 完成（V1/V2 已本地跑通） |
| M2 | **下一步**：maxSteps / schema 校验 / Abort + `web/m2-guards/` |
