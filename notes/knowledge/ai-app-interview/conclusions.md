# AI 应用开发知识要点

覆盖范围：Prompt Engineering、Function Calling、Context Engineering、Harness、Agent、SKILL、MCP、安全边界。

浏览器版：[review.html](./review.html)

---

## 01 · AI 应用分层

| 层级 | 职责 |
|------|------|
| Model | 基于 Context 推理；生成文本或结构化 `tool_calls` |
| Context | 单次请求中提供给模型的全部输入内容 |
| Tools | 工具声明（schema）与可执行实现（本地脚本、API、MCP 等） |
| Harness | 运行时：消息循环、工具执行、结果回写、权限与资源控制、Context 组装 |
| Agent | 在 Harness 之上、面向目标的多步自主循环，直至完成或被强制终止 |

要点：

- 模型不直接执行外部副作用；执行由 Harness 调度 Tools 完成。
- Agent 与「带工具的单轮对话」的差异在于是否具备目标驱动的多步循环。

---

## 02 · Context Engineering

定义：决定向模型窗口放入哪些信息、以何种顺序与篇幅放入，并使组合适配当前任务。

与 Prompt Engineering 的关系：

| | Prompt Engineering | Context Engineering |
|--|--------------------|---------------------|
| 关注点 | 指令如何编写（角色、任务、约束、格式、示例等） | 窗口内装载哪些内容、容量如何分配、如何压缩与检索 |
| 关系 | PE 产出的指令文本是 Context 的组成部分 | CE 统筹整窗信息，含 PE 文本、工具 schema、历史、检索结果等 |

优先级原则（随任务动态调整，非固定表）：

1. 当前用户请求  
2. 系统说明 / 已激活的流程规范（如 SKILL 全文）  
3. 工具 schema（任务需要工具时）  
4. 当前步骤的关键证据（工具结果、工作集文件片段、检索命中）  
5. 对话历史（可摘要）  
6. 大文件全文（应切片或摘要，避免整篇灌入）  

工作集优先：与当前修改目标直接相关的文件片段、刚返回的工具结果，其优先级可高于无关历史与部分检索结果。

---

## 03 · Context 组装策略

| 策略 | 定义 | 适用条件 |
|------|------|----------|
| 工作集切片（Chunk） | 从已确定的对象中选取相关片段 | 目标文件/对象已知 |
| 摘要压缩（Summarize） | 将历史或长文压缩后写回后续 Context | 窗口不足，需保留要点而非全文 |
| RAG | 经索引/相似度检索后将 top-k 片段写入 Context | 语料范围大、命中位置事先未知 |
| 长期 Memory | 持久化存储于窗口外，按需检索后注入 | 跨会话偏好、约定等；禁止每轮全量注入 |

说明：摘要压缩服务于 Context 预算管理，与「向用户交付一份总结」的产品功能不是同一概念。

---

## 04 · Prompt Engineering 与 Function Calling

### 4.1 消息角色

常见角色：`system`（系统约束与角色）、`user`（用户输入）、`assistant`（模型输出）、`tool`（工具执行结果回传）。多轮对话中角色序列构成完整交互状态。

### 4.2 System Prompt 设计要素

| 要素 | 说明 |
|------|------|
| 角色（Person） | 模型扮演的身份与能力边界 |
| 任务（Task） | 需要完成的目标 |
| 约束（Constraints） | 禁止项、安全与业务规则 |
| 输出格式（Output） | 期望的结构与呈现形式 |

抽象规则的遵循能力弱于对具体示例的模仿；关键格式约束应辅以示例或 API 级约束。

### 4.3 Zero-shot 与 Few-shot

| 方式 | 定义 | 用途 |
|------|------|------|
| Zero-shot | 不提供示例，直接下达任务 | 任务模式常见、规则清晰时 |
| Few-shot | 先提供输入→输出示例，再处理新输入 | 需固定模式或覆盖边界情形时 |

示例应覆盖边界情况；仅依赖系统提示中的抽象格式说明，字段级一致性仍可能漂移。

### 4.4 Chain of Thought（CoT）

原理：自回归逐 token 生成；若不要求写出中间步骤，易发生跳步并提高错误率。强制展开中间推理可降低跳步风险。

| 类型 | 做法 | 适用 |
|------|------|------|
| Zero-shot CoT | 使用引导语要求分步思考 | 通用推理（数学、逻辑、常识） |
| Few-shot CoT | 示例中展示完整推理链 | 领域特定推理方式需示范时 |

### 4.5 结构化输出

可靠性由弱到强大致为：

1. 仅在 System Prompt 中描述格式  
2. Few-shot 示范目标格式  
3. API 层 `response_format` / constrained decoding（在采样层面约束输出）  

需要严格 schema 时，应优先采用 API 级约束，而非仅依赖提示词约定。

### 4.6 Prompt 调试

流程：定位失败样例 → 最小改动修改提示或示例 → 回归测试（含未改动的相关用例，避免过拟合单点修复）。

### 4.7 Function Calling

本质：模型输出结构化 `tool_calls`（名称与参数）；由应用侧代码执行工具，并将结果以 tool 消息写回后再次请求模型。

Tool Schema 设计应包含：能力说明、适用场景、限制与参数约束。

| 流程 | 说明 |
|------|------|
| 单轮 | 用户请求 → 模型 `tool_calls` → 执行 → tool 消息回传 → 模型最终回复（通常涉及两次模型请求） |
| 多轮 | 多工具可并行（无依赖）或串行（有依赖）；需 `max_iterations` 与重复调用检测 |
| 错误处理 | 一般执行失败可脱敏后回传模型以生成降级说明；安全相关错误应由代码层兜底，不得仅依赖模型 |

职责划分：意图与工具选择倾向由模型完成；业务状态机、权限与安全校验由代码完成。

---

## 05 · Harness Engineering

定义：包裹模型的运行时层，负责使 Agent 循环可运行、可终止、可审计，并落实安全与资源策略。

| 类别 | 内容 |
|------|------|
| 应由 Harness 强制 | 消息/工具循环与步数上限；工具执行、超时与重试；高危操作确认；token/费用上限；Context 组装与压缩调度；Memory 读写管线；日志与追踪 |
| 可由 Prompt 表达 | 语言、语气、详尽程度等偏好类约束 |

原则：会造成不可逆损害、资源失控或循环无法收敛的行为，必须由代码强制；不得仅依赖提示词约束。

---

## 06 · Agent Loop

标准阶段：感知 → 规划 → 行动 → 观察，可迭代执行。

| 阶段 | 职责归属 |
|------|----------|
| 感知 | 模型判断信息缺口；Harness 调度 Tools 采集；结果写入 Context 后由模型再解释 |
| 规划 | 模型拆解步骤（定位问题、修改方案、验证方式） |
| 行动 | 模型发出 `tool_calls`；Harness 调度；Tools 产生外部副作用 |
| 观察 | Harness 将执行结果写回 Context；模型评估是否达成目标 |

终止条件：模型判定目标完成并产出最终回复；或 Harness 触发最大步数、超时、用户取消等强制终止。

---

## 07 · 工具调用协议位置

执行依据为结构化 `tool_calls`，而非自然语言思考过程。

```
模型输出 tool_calls
  → Harness 校验并调度对应 Tool
  → 执行结果写入 Context
  → 再次请求模型
```

若仅有自然语言意图描述而无 `tool_calls`，Harness 不得执行外部操作。

---

## 08 · SKILL

定义：面向特定任务的流程规范（SOP），以文档形式存在，经 Harness 发现并注入 Context，供模型遵循。

机制：

1. **发现**：扫描技能目录，向模型暴露名称与适用说明（description）  
2. **加载**：判定相关后读取全文（及必要附件）并注入 Context  
3. **执行**：模型依据规范调用普通 Tools 或继续推理；SKILL 本身通常不是可 `call` 的业务工具  

渐进披露：目录级元数据常驻；全文按需加载，避免全量技能正文同时占用窗口。

触发方式包括：用户显式指定、Harness 基于描述匹配、模型依据目录说明选择后加载。

---

## 09 · MCP 能力模型

Model Context Protocol：Host 与外部能力进程之间的业务协议层。

| 能力 | 定义 |
|------|------|
| Tools | 可调用动作及其参数 schema；由 Server 执行 |
| Resources | 可读取的数据或文档资源，作为 Context 原料 |
| Prompts | Server 提供的可参数化提示模板 |

拓扑：

```
用户 → Host（含 MCP Client）↔ Model
              ↓
         MCP Server → 外部系统（如 GitHub API）
```

模型不与 MCP Server 直连；由 Host 内 Client 完成协议通信。

---

## 10 · MCP 传输与生命周期

本地常见传输：stdio（Host 拉起 Server 子进程，经标准输入/输出交换 JSON-RPC）。远程场景多采用 Streamable HTTP 等网络传输。

生命周期：

```
Spawn → Initialize → List → Call
```

| 步骤 | 说明 |
|------|------|
| Spawn | Host 启动 Server 进程并建立 Client |
| Initialize | 握手：协商协议版本与能力 |
| List | 枚举 tools/resources/prompts，将声明纳入 Context |
| Call | 模型产生调用意图后，Client 发起 `tools/call`，Server 执行并返回结果 |

stdio 下标准输出专用于协议报文；诊断日志应写入标准错误，避免污染协议流。

参考实现：`notes/mcp-demo/`。

---

## 11 · SKILL 与 MCP 的调用关系

| | SKILL | MCP Tool |
|--|-------|----------|
| 进入路径 | Harness 将规范文本注入 Context | schema 进入 Context 后，经 `tool_calls` 由 Client 调用 Server |
| 作用 | 规定「如何完成任务」的流程与准则 | 提供「接触外部系统」的可执行能力 |
| 组合 | 可先注入 SKILL，再在其指导下调用 MCP 或其他 Tools | |

示例：

- 显式指定教学/流程技能 → 加载 SKILL  
- 明确要求使用某 MCP 服务操作外部资源 → MCP Tool 路径  
- 按内部规范审查并在远端留下评论 → SKILL（规范）+ MCP（远端操作）

---

## 12 · 权限、沙箱与安全边界

| 风险类型 | 主要控制面 |
|----------|------------|
| 高危本地操作（如破坏性删除） | Harness：拦截、二次确认、沙箱 |
| 外部凭证权限过大 | 凭证最小权限；Server/平台侧 scope 限制；Host 可对敏感操作再审批 |
| 密钥或敏感文件外泄 | Harness：禁读、脱敏、拦截外发；凭证仅在调用路径使用，不写入模型 Context |
| 任务所需能力过宽 | Harness：工具白名单、网络/文件系统沙箱，按任务授予最小能力集 |

Prompt 中的安全说明属于软约束，不能替代代码与凭证层硬约束。

---

## 13 · 端到端结构（编码助手示例）

任务形态：定位缺陷 → 修改代码 → 验证 → 创建 Pull Request。

参考流水线：

1. Harness 组装 Context：系统说明、项目约束、MCP/工具 schema、SKILL 目录（相关时注入全文）、必要代码片段与日志  
2. 模型规划并产生 `tool_calls`；Harness 执行并回写结果；循环直至目标完成或强制终止  
3. 通过 MCP 或平台工具创建 PR，并向用户返回结论  
4. 全程施加高危确认、步数/超时上限、凭证与沙箱策略  
5. Context 不足时启用摘要或工作集切片  

---

## 总览

```
用户
  → Host / Harness（组装 Context）
  ↔ Model（推理 / tool_calls）
       ↓
  本地 Tools 或 MCP Client → Initialize → List → Call → Server → 外部系统
       ↓
  结果写入 Context → 再次请求 Model → … → 完成或强制终止

Prompt Engineering：指令与示例、结构化输出、工具调用意图的生成侧设计
Context Engineering：整窗信息的选择、排序、压缩与检索
SKILL：流程规范注入 Context
MCP：标准化外部能力接入（Tools / Resources / Prompts）
安全：Harness 与凭证硬约束；Prompt 为辅助
```
