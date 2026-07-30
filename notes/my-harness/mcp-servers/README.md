# my-harness 内的 MCP Server

**Tools 在哪注册？** 在各 **MCP Server 进程**里（`registerTool`）。

**多 Server 怎么管？** Host 用 `src/mcp/registry.ts` 注册表（数组 catalog + 会话 Map）：

```text
mcpRegistry = [
  { id: "demo", path: ../mcp-demo/server.mjs },
  { id: "fs",   path: mcp-servers/fs-sandbox/server.mjs },
]
可同时 connectMany(["demo","fs"])

模型看到的工具名 = MCP 原名（echo / add / read_file …）
同名冲突：catalog 顺序 first-wins（对齐 Pi extensions：keep first）
调用时：
  executeTool(call)
    → registry.resolve("read_file")   // 第一个拥有该名的 Client
    → Client[fs].callTool("read_file", args)
```

| id | 路径 | tools（原名） |
|----|------|---------------|
| `demo` | `notes/mcp-demo/server.mjs` | echo, add |
| `fs` | `mcp-servers/fs-sandbox/server.mjs` | list_files, read_file, write_file |

页面：`web/m5-mcp/` 可多选 Server；路由表 / `conflicts` 可见 first-wins 结果。
