# MCP Demo（stdio 最小可跑）

配合 Sigma 课程 Concept 9–10：亲手写一个 MCP Server，搞清 Tools / Resources / Prompts 和传输方式。

## 这个 Server 提供什么

| 类型 | 名字 | 作用 |
|------|------|------|
| Tool | `echo` | 回显文本，验证调用链 |
| Tool | `add` | 两数相加 |
| Resource | `demo://notes/welcome` | 一份可读参考笔记 |
| Prompt | `standup` | 带 `date` 参数的一键提示模板 |

## 安装

```bash
cd notes/mcp-demo
npm install
```

## 用 MCP Inspector 自测（推荐，不依赖 Cursor）

```bash
npm run inspect
```

浏览器里可以：列出 tools → 调 `add` → 读 resource → 看 prompt。

## 接到 Cursor

在 Cursor MCP 设置里加（路径改成你的绝对路径）：

```json
{
  "mcpServers": {
    "learn-ai-note-demo": {
      "command": "node",
      "args": [
        "/Users/sugar/Documents/fe/leran-ai-note/notes/mcp-demo/server.mjs"
      ]
    }
  }
}
```

或项目级 `.cursor/mcp.json`（若你使用该机制）。

配置后重启 MCP / 重开 Agent，在对话里试：

> 用 learn-ai-note-demo 的 add 算 12+30

## 代码怎么对应概念

```
Cursor Host
  └─ MCP Client  --stdio(JSON-RPC)-->  node server.mjs (MCP Server)
                                            ├─ registerTool
                                            ├─ registerResource
                                            └─ registerPrompt
```

1. Host **拉起** `node server.mjs` 子进程（stdio）
2. 双方做 **initialize 握手**，再 `tools/list` 等
3. Model 产出 `tool_calls` → Client 发 `tools/call` → 你的 handler 跑 → 结果回 Host → 进 Context

## 关键坑

- **不要用 `console.log`**：stdout 专给协议；日志用 `console.error`
- Tool 要有 **inputSchema**（本 demo 用 zod）
- Resource ≠ Tool 说明书；Prompt ≠ SKILL 全文 SOP

## 和面试话术对照

- **Tools**：声明（schema）+ Server 内实现
- **Resources**：可读数据 URI
- **Prompts**：Server 提供的提示模板
- **stdio**：本地进程管道；远程一般用 Streamable HTTP
