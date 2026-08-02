# my-harness 内的 MCP Server

**Tools 在哪注册？** 在各 **MCP Server 进程**里（`registerTool`）。

**多 Server 怎么管？** Host 用 `src/mcp/registry.ts`：

```text
mcpRegistry = [
  { id: "demo",   transport: "stdio", path: ../mcp-demo/server.mjs },
  { id: "fs",     transport: "stdio", path: mcp-servers/fs-sandbox/server.mjs },
  { id: "remote", transport: "http",  url:  http://127.0.0.1:8790/mcp },
]

模型看到的工具名 = MCP 原名；同名 catalog 顺序 first-wins
stdio：spawn → 管道 JSON-RPC
http ：StreamableHTTPClientTransport(url) → POST + mcp-session-id
```

| id | 传输 | 说明 |
|----|------|------|
| `demo` | stdio | echo, add |
| `fs` | stdio | list/read/write_file |
| `remote` | **Streamable HTTP** | ping / session_info / remember / recall（有状态 session） |

## 远程 vs 常规 HTTP

| | 常规 REST | 远程 MCP（本演示） |
|--|-----------|-------------------|
| 端点 | 多路径 `/users` `/orders` | 通常单端点 `POST /mcp` |
| 载荷 | 资源 JSON | **JSON-RPC**（initialize / tools/list / tools/call） |
| 状态 | 常无状态 | **有状态 session**（头 `mcp-session-id`）；也可做成无状态 |
| 连接 | 每请求独立 TCP/HTTP | Host 侧复用 Client 会话；stdio 则是长活子进程 |

`remember` → `recall` 同 session 能读到；断开/换 session 则丢 —— 用来体会「不是无状态 REST」。

demo 启动时会自动拉起 `remote-http`（:8790）；也可手动：

```bash
node mcp-servers/remote-http/server.mjs
curl -s http://127.0.0.1:8790/health
```

页面：`web/m5-mcp/` 勾选 `remote` 连接。
