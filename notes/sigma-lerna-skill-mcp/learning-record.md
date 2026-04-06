# MCP 和 Skill 原理深度理解 - 学习记录

> 学习时间：2026-03-22 17:00 - 19:30
> 学习者水平：Intermediate（有一定实战经验，缺系统原理）

---

## 一、诊断阶段

### Q1：你目前了解哪些？
**选项：** 两个都用过，想深入理解原理

### Q2：用自己的话说说 MCP 和 Skill 的核心区别
**选项：** MCP 是工具调用协议，Skill 是提示词包——本质不同

**导师评价：** 抓了一部分真相，但还不完整。

---

## 二、诊断性问题：为什么需要 MCP

### Q3：MCP 这个协议到底规定了什么？解决的核心问题是什么？
**回答：** 规定大模型和外部系统交互的一种方式。解决大模型知识库有限，拓展大模型能力边界

**导师追问：** MCP 出现之前 AI 也能调用工具（如 Function Calling），MCP 存在的意义是什么？

### Q4：没有 MCP 的世界里，要让工具同时支持 Claude、GPT、Gemini 怎么做？
**回答：** 统一标准，没有的话得按各家的标准来实现，成本高，定制逻辑多。

**导师评价：** 抓住了核心价值——标准化带来的互操作性（interoperability）。

### Q5：MCP 具体规定了哪些东西？配置里写的是什么？
**回答：** npx 调用执行指令，需要鉴权传入 token，其它的不清楚了

**导师追问：** 配置层已经熟了，测试协议层理解。

### Q6：当 AI 需要调用 MCP 工具时，完整过程是怎样的？
**回答：** 根据 prompt 和工具内每个功能的 prompt 相匹配，然后解析出相关的参数，执行代码调用，返回内容然后塞到对话的上下文给到 AI 总结。工具 Schema 是 MCP SDK 服务提供的注册。

**导师评价：** 核心流程完全理解——匹配 → 解析参数 → 执行 → 结果注入上下文 → AI 总结。

---

## 三、诊断性问题：Skill 本质

### Q7：Skill 是怎么"帮助 AI 做事"的？实际发生了什么？
**回答：** 根据 skill 里的 CLI 指令，调用本地或安装的 CLI 去读取内容，结果注入上下文

**导师澄清：** ❌ 误解。需要修正——**Skill 本身不调用 CLI，它只提供"指令"**。
- 系统把 Skill 的 SKILL.md 加载到 AI 上下文
- SKILL.md 告诉 AI 遇到这类任务该怎么做
- AI 用自己本来就会的能力去执行
- Skill 本身不执行任何代码，只是"教 AI 怎么做"

**核心区别：**
- MCP = AI 通过它真正拥有了执行能力（外部工具真的被调用了）
- Skill = AI 知道了更好的工作方法（知识和指令被注入上下文）

---

## 四、学习路径建立

建立了 12 个概念的路线图：

| # | 概念 | 状态 |
|---|------|------|
| 1 | 为什么需要 MCP | ✅ |
| 2 | MCP 三角色架构 | ✅ |
| 3 | JSON-RPC 2.0 | ✅ |
| 4 | MCP 三大原语 | ✅ |
| 5 | 工具 Schema 注册与发现 | ✅ |
| 6 | MCP 完整生命周期 | ✅ |
| 7 | MCP vs Function Calling | ✅ |
| 8 | Skill 本质 | ✅ |
| 9 | Skill 生命周期 | ✅ |
| 10 | Skill 与 MCP 协同 | ✅ |
| 11 | 实战：实现 MCP Server | ✅ |
| 12 | 实战：编写 Skill | ⏳ |

---

## 五、系统化学习

### #1 为什么需要 MCP

**诊断性问题：MCP 之前有哪些方案？痛点是什么？**

| 痛点 | 学习者处理方式 | 局限性 |
|------|------------|--------|
| 格式靠人设计，不精确 | 自己参考 vibe coding 项目写 Prompt | 不同人写出来不一样 |
| 安全靠手写代码兜底 | 用户确认 + 沙箱 | 每个工具都要单独写 |
| 换模型效果不稳定 | 靠重试和调 Prompt 弥补 | 没有根本解决"各家理解不一致" |

**MCP 解决的就是这三个问题：**
1. **标准化格式** → 协议统一了工具描述的 Schema
2. **安全性内置** → 协议层面规定参数校验、错误处理
3. **跨模型兼容** → 一次实现，到处运行

---

### #2 MCP 三角色架构

**初步理解：** 客户端做 Host，Client 是 MCP 客户端，Server 是用户按 MCP SDK 封装的具体工具

**导师纠正：** Host ≠ Client，它们是两个不同的东西：
- **Host** = 承载 AI 的应用程序本身（WorkBuddy、Claude Desktop）
- **Client** = 嵌在 Host 里的协议组件，负责和 Server 通信
- 一个 Host 可以同时连多个 Server（一 Client 对一 Server）

**关系图：**
```
WorkBuddy（Host）─── 内含 MCP Client
        ├── Client 1 ──→ Filesystem Server
        ├── Client 2 ──→ Git Server
        └── Client 3 ──→ Database Server
```

**MCP Server 实现语言：** TypeScript SDK、Python SDK、Go、Rust 等

**追问：mcp.json 是给谁用的？**
- ❌ 不是 Client 直接读
- ✅ **Host 读了之后，用参数启动 Server 进程**
  - `command` + `args` → Host 用来启动 Server
  - `env` → Server 进程的环境变量
  - Client 负责和已启动的 Server "说话"

---

### #3 JSON-RPC 2.0

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

**追问：批量请求怎么匹配响应？**
**回答：** 每次请求前生成一个 id，和对应的响应 id 匹配

**✅ 核心：** 固定格式 + id 配对 + 错误规范

---

### #4 MCP 三大原语：Tools / Resources / Prompts

**场景判断：**

| 场景 | 原语 | 理由 |
|------|------|------|
| 读本地 PDF 文件 | R (Resources) | 把文件内容注入上下文 |
| 写欢迎用户的 prompt 模板 | P (Prompts) | 预设的提示词模板 |
| git 提交代码 | T (Tools) | 实际执行操作，有副作用 |

**本质区别：**

| | Tools | Resources | Prompts |
|--|-------|-----------|---------|
| 触发方式 | AI **主动调用** | AI **主动读取** | AI **主动调用** |
| 方向 | AI → 执行外部操作 | AI → 拉取数据到上下文 | AI → 拉取 prompt 模板 |
| 是否改变外部世界 | ✅ 可能改变 | ❌ 只读 | ❌ 只读 |

**Resources vs Tools 的判断标准：**
> **Resources = 受控的数据访问，结果可预期；Tools = 需要 AI 动态决策的操作。**

| 操作 | 为什么是 Tools 而非 Resources |
|------|-------------------------------|
| 读 `/workspace/config.json` | ✅ Resources——路径固定，内容可预期 |
| 搜索"所有包含关键词 X 的文件" | ❌ Tools——返回结果不可预测，AI 需要决策 |
| 发送一封邮件 | ✅ Tools——有副作用，会改变收件箱状态 |
| 读取一封邮件 | ✅ Resources——只是把邮件内容拉进上下文 |

---

### #5 工具 Schema 的注册与发现机制

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

**综合题 Notion 数据库查询：**
- **答案：** 用 Tools
- **理由：** 查询条件是动态的、AI 需要组合查询条件、结果不可预期

---

### #6 MCP 请求-响应完整生命周期

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

---

### #7 MCP vs Function Calling

**回答：** MCP 是 AI 与外部世界沟通的标准，可以便捷拓展；Function Calling 是指令解析，由对应客户端实现，AI 根据 prompt 格式解析调用返回结果后注入

**导师翻译：**

| | Function Calling | MCP |
|--|----------------|-----|
| 范围 | 单厂商私有 | 跨厂商通用 |
| 工具开发者 | 要为每个 AI 平台写适配层 | 一次实现，到处运行 |
| 协议层 | 各家自己定义 | 社区共建开放标准 |
| 生态 | OpenAI Tool Use / Claude / Gemini 各玩各的 | 统一生态，工具可复用 |

**本质区别一句话：**
> Function Calling 是"各家关起门来的接口"，MCP 是"大家商量好的通用插座"。

**附加问题：MCP 是哪个厂商提出的？**
**回答：** Anthropic（Claude 背后的公司），2024 年底作为开放标准发布

---

### #8 Skill 本质：指令注入而非执行

**误解澄清：**
- ❌ 原来理解：Skill 调用 CLI 去读取内容
- ✅ 正确理解：Skill 只提供指令，AI 用已有能力执行

**PDF Skill 完整流程：**
1. 系统把 PDF Skill 的 SKILL.md 加载到 AI 的上下文里
2. SKILL.md 里写的是告诉 AI"遇到这类任务该怎么做"的指令集
3. AI 有了这个指令之后，用自己本来就会的能力（读文件、解析内容）去执行
4. **Skill 本身不执行任何代码，只是"教 AI 怎么做"**

**Skill 加载时机：**
> 是 **WorkBuddy（Host）决定的**，不是 AI 决定的。
> - 基于规则/关键词匹配
> - 发生在 AI 开始处理请求之前

| | MCP | Skill |
|--|-----|-------|
| 实质 | **协议层**：让 AI 真正能执行外部操作 | **指令层**：告诉 AI 遇到某类任务怎么做 |
| 执行者 | 外部 MCP Server | AI 本身（用已有能力） |
| 核心产物 | JSON 数据（返回给 AI） | Prompt 指令（注入上下文） |
| 生命周期 | 实时连接，随时调用 | Skill 被加载到对话上下文 |

---

### #9 Skill 生命周期：加载 → 触发 → 执行

**Skill 加载策略：**
> 不是"谁在前加载谁"，而是：**根据用户的任务，把相关的 Skill 动态加载进来**。

**多 Skill 共存：**
- 可以同时加载多个 Skill
- 真正的加载策略是 Host 根据任务动态决定
- Skill 不直接操作系统，只给 AI 提供指令

---

### #10 Skill 与 MCP 的协同模式

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

---

### #11 实战：实现一个 MCP Server

**场景：天气查询 MCP Server**

| 问题 | 回答 | 评价 |
|------|------|------|
| 用什么原语？ | Tools | ✅ |
| 注册哪些工具？ | HTTP + 天气查询 | ✅ |
| Description 怎么写？ | "提到天气就可以" | ✅ 越详细越好 |

**Tools 粒度设计：**
- **方案 A（✅ 推荐）：** `get_current_weather(city, unit)` 一个工具搞定
  - 减少 AI 决策成本，参数越丰富，AI 能处理的场景越多
- **方案 B：** `get_current_weather` + `get_forecast` 两个工具分开

**穿衣推荐功能放哪里？**
- ❌ 不需要新开 MCP，因为穿衣推荐本身不需要调用外部工具
- ✅ 应该放在 **Skill** 里——因为它是"根据温度推理穿什么"的领域逻辑，不需要外部数据

---

## 六、Mastery Check 综合题

### 题目 1：完整调用链路

**学习者答案：** WorkBuddy 根据 mcp.json 启动 MCP Servers，同时为每个 Server 创建一个 Client，Server 告诉 Client 所有的工具列表，这个列表被塞到上下文中，模型根据描述判断使用哪个工具，再通过 Client 传参调用

**导师补充：** 基本正确，但有一个小细节——工具列表是 **Client 发请求、Server 回复** 的，而不是 Server 主动推。

**最终链路：**
```
WorkBuddy 读取 mcp.json → 启动 MCP Server 进程
         ↓
Server 启动完成，通过 stdio 连接到 Host 的 Client
         ↓
Client → Server 发送 list_tools 请求
         ↓
Server 回复工具列表（包含 name/description/schema）
         ↓
Host 把列表转成 AI 可见的上下文
         ↓
AI 推理 → 决定调用 → Client 发送 JSON-RPC 调用请求
         ↓
Server 执行 → 返回 JSON 结果
         ↓
Host 把 JSON 嵌入上下文 → AI 继续推理
```

**评分：** 85/100

---

### 题目 2：热搜 MCP Server 设计

**设计方案：** 用 Resources 原语实现，理由是"只是读取数据，没有副作用"

**学习者答案：** 使用 Tools 实现，因为查询条件是动态的，需要动态传参

**导师评价：** ✅ 答案正确

**追问：为什么"没有副作用"这个理由站不住脚？**

**学习者回答：** Resources 只读受控数据的访问

**导师总结：**
> **Resources vs Tools 的判断标准：不是"有没有副作用"，而是"结果是否可预期、受控"。**
> 热搜的数据范围不可控、AI 查什么关键词也不固定，超出 Resources 的设计边界。

**评分：** 90/100

---

### 题目 3：MCP 跨平台复用

**开发者说法：** "MCP 是开放标准，所有 MCP Server 应该可以直接用"

**学习者答案：** 不一定，大模型能力有差别，最终抉择可能不一样

**导师评价：** 抓到了效果层面的差异，没抓到 Host 兼容性这个更根本的问题。

**导师总结：**
> **前半句（✅ 正确）：** MCP Server 代码可以跨 AI 平台复用，不需要任何修改——这正是开放标准的价值。
>
> **后半句（❌ 不完全对）：** 真正的问题是——**Host 应用本身支不支持 MCP？**
> - Claude Desktop / WorkBuddy ✅ 支持 MCP
> - GPT 的官方 ChatGPT ❌ 不支持 MCP
>
> 所以更准确的说法是：**MCP Server 代码可以跨 AI 平台复用，但前提是目标平台（Host）本身支持 MCP 协议。**

**评分：** 75/100

---

## 七、最终评估

**Mastery Check 总分：约 87%**

| 概念 | 掌握度 |
|------|--------|
| #1 为什么需要 MCP | ✅ 扎实 |
| #2 三角色架构 | ✅ 扎实（Host/Client/Server 职责清晰） |
| #3 JSON-RPC 2.0 | ✅ 扎实 |
| #4 三大原语 Tools/Resources/Prompts | ✅ 扎实 |
| #5 Schema 注册发现机制 | ✅ 扎实 |
| #6 完整生命周期 | ✅ 扎实 |
| #7 MCP vs Function Calling | ✅ 扎实 |
| #8 Skill 本质 | ✅ 扎实（已纠正原误区） |
| #9 Skill 生命周期 | ✅ 扎实 |
| #10 Skill 与 MCP 协同 | ✅ 扎实 |
| #11 实战设计 | ✅ 扎实 |
| #12 编写 Skill | ⏳ 未覆盖 |

---

## 八、三个核心认知升级

1. **MCP 解决的不只是"调用工具"，而是标准化互操作性**——让工具开发者一次实现、到处运行

2. **Skill 是指令注入，不是执行工具**——之前误以为 Skill 调用 CLI，实际上 Skill 只提供指令，真正执行的是 AI 调用的工具

3. **Resources vs Tools 的判断标准**：不是"有没有副作用"，而是"结果是否可预期、受控"

---

## 九、下次学习建议

- **#12 实战：自己动手写一个 Skill**
- 深入理解 MCP Server 的具体 SDK 实现（TypeScript / Python）
- 探索 MCP 的 Prompts 原语的实战用法
- 补充 #7 中 Host 兼容性这个更根本的问题
