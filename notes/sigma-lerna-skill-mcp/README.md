# SKILL 与 MCP 相关原理学习

使用 [sigma skill 引导进行学习](./session.md)

[[toc]]

## MCP
### 1. MCP解决三个问题

1. **标准化格式** → 协议统一了工具描述的 Schema
2. **安全性内置** → 协议层面规定参数校验、错误处理
3. **跨模型兼容** → 一次实现，到处运行

### 2. MCP 三角色架构

- **Host** = 承载 AI 的应用程序本身（WorkBuddy、Claude Desktop）
- **Client** = 嵌在 Host 里的协议组件，负责和 Server 通信
- 一个 Host 可以同时连多个 Server（一 Client 对一 Server）

```text
WorkBuddy（Host）─── 内含 MCP Client
        ├── Client 1 ──→ Filesystem Server
        ├── Client 2 ──→ Git Server
        └── Client 3 ──→ Database Server
```

Host 读取 mcp.json 启动 Server

### 3. JSON-RPC2.0

**JSON vs JSON-RPC：**

- JSON = 数据格式
- JSON-RPC = 基于 JSON 的远程调用协议（多了 method/params/id 规范）

**JSON-RPC 2.0 请求格式：**

```json
{
  "jsonrpc": "2.0",      // 协议版本
  "method": "sum",        // 方法名
  "params": [3, 5],      // 参数
  "id": 1                // 配对请求和响应
}
```

**响应格式：**

```json
// 成功
{ "jsonrpc": "2.0", "result": 8, "id": 1 }

// 失败
{ "jsonrpc": "2.0", "error": { "code": -32600, "message": "Invalid Request" }, "id": 1 }
```

### 4. MCP 三大原语：Tools / Resources / Prompts

**场景判断：**

| 场景               | 原语            | 理由          |
| ---------------- | ------------- | ----------- |
| 读本地 PDF 文件       | R (Resources) | 把文件内容注入上下文  |
| 写欢迎用户的 prompt 模板 | P (Prompts)   | 预设的提示词模板    |
| git 提交代码         | T (Tools)     | 实际执行操作，有副作用 |

**本质区别：**

| <br />   | Tools       | Resources     | Prompts           |
| -------- | ----------- | ------------- | ----------------- |
| 触发方式     | AI **主动调用** | AI **主动读取**   | AI **主动调用**       |
| 方向       | AI → 执行外部操作 | AI → 拉取数据到上下文 | AI → 拉取 prompt 模板 |
| 是否改变外部世界 | ✅ 可能改变      | ❌ 只读          | ❌ 只读              |

**Resources vs Tools 的判断标准：**

> **Resources = 受控的数据访问，结果可预期；Tools = 需要 AI 动态决策的操作。**


### 5. 工具 Schema 的注册与发现机制

**发现链路：**

```
1. WorkBuddy（Host）读取 mcp.json
         ↓
2. Host 启动 MCP Server 进程（command + args）
         ↓
3. Server 启动完成，通过 stdio 与 MCP Client 建立连接
         ↓
4. Client → Server 发送 list_tools 请求
         ↓
5. Server 回复工具列表（包含所有工具的 name/description/schema）
         ↓
6. Host 把工具列表转成 AI 可见的上下文
         ↓
7. AI "看到"所有可用工具及其描述
         ↓
8. 你发消息 → AI 判断用哪个工具 → 发起调用
```

**Schema 示例：**

```json
{
  "name": "search_files",
  "description": "Search for files matching a pattern",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Directory to search in" },
      "pattern": { "type": "string", "description": "Glob pattern to match" }
    },
    "required": ["path", "pattern"]
  }
}
```

**关键结论：**

> Schema 告诉 AI 参数的结构和类型，AI 自己推理出具体的值。Description 写得越精确，AI 推理出来的参数就越准确。


### 6. MCP 请求-响应完整生命周期

```
① 用户发消息
         ↓
② AI 推理 + 决策：决定调用哪个 Tool
         ↓
③ Client 构造 JSON-RPC 请求 → 发给 Server
         ↓
④ Server 执行操作 → 返回 JSON-RPC 响应
         ↓
⑤ Host 把 JSON 结果注入上下文（替换工具调用为文字描述）
         ↓
⑥ AI 继续推理 → 最终回复用户
```

**追问：params 从哪里来？**
**回答：** AI 推理出来的（从对话上下文里推断）


### 7. MCP vs Function Calling

| <br /> | Function Calling                       | MCP        |
| ------ | -------------------------------------- | ---------- |
| 范围     | 单厂商私有                                  | 跨厂商通用      |
| 工具开发者  | 要为每个 AI 平台写适配层                         | 一次实现，到处运行  |
| 协议层    | 各家自己定义                                 | 社区共建开放标准   |
| 生态     | OpenAI Tool Use / Claude / Gemini 各玩各的 | 统一生态，工具可复用 |

**本质区别一句话：**

> Function Calling 是"各家关起门来的接口"，MCP 是"大家商量好的通用插座"。

## SKILL

### 1. Skill 本质
Skill 只提供指令，AI 用已有能力执行

**PDF Skill 完整流程：**

1. 系统把 PDF Skill 的 SKILL.md 加载到 AI 的上下文里
2. SKILL.md 里写的是告诉 AI"遇到这类任务该怎么做"的指令集
3. AI 有了这个指令之后，用自己本来就会的能力（读文件、解析内容）去执行
4. **Skill 本身不执行任何代码，只是"教 AI 怎么做"**

**Skill 加载时机：**

> 是 **WorkBuddy（Host）决定的**，不是 AI 决定的。
>
> - 基于规则/关键词匹配
> - 发生在 AI 开始处理请求之前

| <br /> | MCP                    | Skill                   |
| ------ | ---------------------- | ----------------------- |
| 实质     | **协议层**：让 AI 真正能执行外部操作 | **指令层**：告诉 AI 遇到某类任务怎么做 |
| 执行者    | 外部 MCP Server          | AI 本身（用已有能力）            |
| 核心产物   | JSON 数据（返回给 AI）        | Prompt 指令（注入上下文）        |
| 生命周期   | 实时连接，随时调用              | Skill 被加载到对话上下文         |

### 2. Skill 生命周期：加载 → 触发 → 执行

**Skill 加载策略：**

> 不是"谁在前加载谁"，而是：**根据用户的任务，把相关的 Skill 动态加载进来**。

**多 Skill 共存：**

- 可以同时加载多个 Skill
- 真正的加载策略是 Host 根据任务动态决定
- Skill 不直接操作系统，只给 AI 提供指令

### 3. Skill 与 MCP 的协同模式

**协同架构：**

```
用户请求
    ↓
Skill 被加载（告诉 AI：遇到这类任务该怎么做）
    ↓
AI 决定调用哪个 MCP 工具（Skill 里可能会提示/暗示该用什么工具）
    ↓
MCP Server 执行实际操作
    ↓
结果返回 AI → Skill 指令继续指导后续步骤
```

**具体例子（处理 Excel 报告）：**

1. Skill（XLSX Skill）加载 → 告诉 AI 处理流程
2. AI 调用 MCP（filesystem-server）读取 Excel
3. AI 根据 Skill 指令处理数据
4. AI 调用 MCP（filesystem-server）写回结果

**设计原则：**

> **Skill（编排层）+ MCP（执行层）** = 现代 AI 应用的主流架构
